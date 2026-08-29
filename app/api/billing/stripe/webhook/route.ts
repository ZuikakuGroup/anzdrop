import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { withApiHandler } from "@/lib/api/handler";
import { downgradeExpiredCardPlan } from "@/lib/plan";
import {
  getSubscriptionPeriodEnd,
  isActiveSubscriptionStatus,
  planFromSubscription,
  unixSecondsToIso,
} from "@/lib/stripe-subscription";

// 同一イベントの再送(Stripeはリトライしうる)による二重処理を防ぐ。
// 初めて見るイベントならtrueを返し、以後の処理を進めてよいことを示す。
async function markEventAsProcessedOnce(
  env: CloudflareEnv,
  eventId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, processed_at) VALUES (?, ?)`
  )
    .bind(eventId, new Date().toISOString())
    .run();

  return result.meta.changes === 1;
}

async function applyEvent(
  event: Stripe.Event,
  stripe: Stripe,
  env: CloudflareEnv
): Promise<void> {
  switch (event.type) {
    // Subscriptionは"POST /api/billing/stripe/subscription"側でPaymentElement
    // 用に直接作成する(Checkout Sessionは使わない)ため、初回有効化も含めて
    // 状態遷移はすべてこのイベント(incomplete→active等)で検知する。
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const isActive = isActiveSubscriptionStatus(subscription.status);
      const periodEnd = getSubscriptionPeriodEnd(subscription);
      const plan = planFromSubscription(subscription, env);

      if (isActive && periodEnd && plan) {
        const newExpiresAt = unixSecondsToIso(periodEnd);

        // plan(Price ID由来)は常に実態へ合わせるが、plan_expires_atは
        // 後退させない。イベントが順不同で届いて古い請求期間末を持つものを
        // 後から処理した場合や、Bitcoinの「期間チャージ」でカードの請求期間より
        // 先まで有効期限が積まれている場合に、より手前の日付で上書きして
        // 課金済みの期間を失わせないための保険(sync側の同じガードと揃える)。
        // SQLiteのmax()はNULL引数があるとNULLを返すため、既存値がNULLの
        // ケースはcoalesceで新しい値へ寄せてから比較する。plan_expires_atは
        // 全経路がtoISOString()の固定フォーマットで書くため、文字列の
        // 辞書順比較がそのまま時刻の前後比較になる。
        //
        // なお plan 列は順不同イベントでは一時的に巻き戻りうる(古いイベントの
        // Price IDで上書きされる)が、次のイベント / sync で実態へ復旧する。
        // 課金済み期間(plan_expires_at)ほど保護の必要が高くないため非対称にしている。
        const result = await env.DB.prepare(
          `
          UPDATE accounts
          SET plan = ?,
              plan_expires_at = max(coalesce(plan_expires_at, ?), ?)
          WHERE stripe_subscription_id = ?
        `
        )
          .bind(plan, newExpiresAt, newExpiresAt, subscription.id)
          .run();

        // accounts.stripe_subscription_idと一致する行が無かった場合の
        // フォールバック。同じアカウントが日をまたがず複数回
        // "POST /api/billing/stripe/subscription"を呼ぶと(例: 2つのタブで
        // それぞれ契約を開始する、支払い後の応答待ちの間にもう一度試す等)、
        // accounts.stripe_subscription_idは最後に呼ばれたSubscriptionのIDで
        // 上書きされる。その状態で先に作成した(古い)方のSubscriptionで
        // 実際に支払いが確定すると、上のUPDATEはどの行にもマッチせず、
        // 顧客は課金されたのにプランが反映されないままになってしまう。
        // Subscription作成時にmetadataへ書き込んでいるaccountId
        // (Stripe側にのみ保持される、支払い確定の事実と紐づくID)を
        // 手がかりに、該当アカウントへ反映し直す。
        if (result.meta.changes === 0) {
          const accountId = subscription.metadata?.accountId;

          if (typeof accountId === "string" && accountId) {
            const currentAccount = await env.DB.prepare(
              `SELECT plan_expires_at, stripe_subscription_id FROM accounts WHERE id = ?`
            )
              .bind(accountId)
              .first<{
                plan_expires_at: string | null;
                stripe_subscription_id: string | null;
              }>();

            const currentSubscriptionId =
              currentAccount?.stripe_subscription_id ?? null;

            // アカウントが今まさに別のSubscription IDを指していて、それが
            // Stripe上でまだactive/trialingなら、このフォールバックによる
            // 上書きは行わない。上書きしてしまうと、その「別の」Subscriptionが
            // 課金され続けるにもかかわらず追跡できなくなる(2つのSubscription
            // が両方課金対象のまま残る)ため。
            let conflictsWithActiveSubscription = false;

            if (
              currentSubscriptionId &&
              currentSubscriptionId !== subscription.id
            ) {
              try {
                const other = await stripe.subscriptions.retrieve(
                  currentSubscriptionId
                );

                conflictsWithActiveSubscription =
                  other.status === "active" || other.status === "trialing";
              } catch (error) {
                // 404(該当Subscriptionが既に存在しない)の場合のみ衝突なしと
                // みなす。それ以外(レート制限等の一時的な障害)まで握りつぶすと、
                // 実際には有効な「別の」Subscriptionを見落として誤って
                // 上書きしてしまいかねない。この場合はイベント全体を失敗させ、
                // 「処理済み」マークも取り消して(POST側の共通処理)、
                // Stripeの再送に賭ける。
                const statusCode =
                  error && typeof error === "object" && "statusCode" in error
                    ? (error as { statusCode?: unknown }).statusCode
                    : undefined;

                if (statusCode !== 404) {
                  throw error;
                }
              }
            }

            // このフォールバック自体が「古いイベントを後から処理した」
            // ケースである可能性もあるため、既存の有効期限より後退する
            // 反映は行わない(既に別の有効なSubscriptionでより新しい
            // 有効期限が設定済みの状態を、古い情報で上書きしないための保険)。
            const currentExpiresAt = currentAccount?.plan_expires_at;
            const isExpirySafe =
              !currentExpiresAt ||
              new Date(newExpiresAt).getTime() >=
                new Date(currentExpiresAt).getTime();

            if (!conflictsWithActiveSubscription && isExpirySafe) {
              await env.DB.prepare(
                `
                UPDATE accounts
                SET plan = ?, plan_expires_at = ?, stripe_subscription_id = ?
                WHERE id = ?
              `
              )
                .bind(plan, newExpiresAt, subscription.id, accountId)
                .run();
            } else {
              console.warn(
                `stripe webhook: skipped fallback update for account ${accountId} ` +
                  `(conflictsWithActiveSubscription=${conflictsWithActiveSubscription}, ` +
                  `expiry current=${currentExpiresAt}, new=${newExpiresAt})`
              );
            }
          }
        }
      }

      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      // 即時ダウングレード(plan_expires_atを現在時刻へ、追跡用IDを外す)。
      // ただしBitcoinの期間チャージで先まで前払いされている分は残す。
      await downgradeExpiredCardPlan(env, { subscriptionId: subscription.id });

      break;
    }

    default:
      break;
  }
}

export const POST = withApiHandler(
  "POST /api/billing/stripe/webhook",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const signature = request.headers.get("stripe-signature");
    const body = await request.text();

    if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
      return Response.json(
        { success: false, error: "署名がありません" },
        { status: 400 }
      );
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Cloudflare WorkersにはNodeのcryptoモジュールが無いため、SubtleCrypto経由の
    // 検証(constructEventAsync + createSubtleCryptoProvider)を使う。
    let event: Stripe.Event;

    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        undefined,
        Stripe.createSubtleCryptoProvider()
      );
    } catch {
      return Response.json(
        { success: false, error: "署名が正しくありません" },
        { status: 400 }
      );
    }

    if (!(await markEventAsProcessedOnce(env, event.id))) {
      return Response.json({ success: true, note: "duplicate event" });
    }

    try {
      await applyEvent(event, stripe, env);
    } catch (error) {
      // 処理中に失敗した場合は「処理済み」のマークを取り消す。マークした
      // ままにすると、Stripeが同じイベントIDで再送してきても
      // markEventAsProcessedOnceが「重複」と誤判定し、二度とプランが
      // 反映されなくなってしまう(顧客は決済済みなのにアップグレードされない)。
      await env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?`)
        .bind(event.id)
        .run();

      throw error;
    }

    return Response.json({ success: true });
  }
);
