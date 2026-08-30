import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { downgradeExpiredCardPlan, getAccountPlanInfo } from "@/lib/plan";
import {
  getSubscriptionPeriodEnd,
  isActiveSubscriptionStatus,
  isDeadSubscriptionStatus,
  planFromSubscription,
  toSubscriptionSummary,
  unixSecondsToIso,
  type StripeSubscriptionSummary,
} from "@/lib/stripe-subscription";
import type { StripeSyncResponse } from "@/app/api/billing/stripe/sync/schema";

// プラン反映は通常 customer.subscription.updated / deleted の Webhook が行うが、
// Webhook が一時的に届かない・失敗し続けると「課金されたのにプランが反映されない」
// 「解約済みなのに追跡が残る」状態になりうる。このエンドポイントは /mypage/billing
// を開いたときにクライアントから呼ばれ、アカウントに紐づく Stripe Subscription の
// 現在の状態を取り直して accounts テーブルへ反映し直す保険。あわせて、画面表示用
// の現在のサブスクリプション要約(自動更新中 / 解約予約中 / 次回更新日)も返す。
//
// このエンドポイント自体はベストエフォート。Stripe への到達に失敗しても
// (レート制限・タイムアウト・障害)、DB 由来の現在のプラン情報で success を返す。
// ここで 500 を返すと、請求ページを開いた課金顧客がページを使えなくなる
// (クライアントは 401 のみをログイン切れとして扱う)。
//
// サーバーへ新しい種類の情報を保存するものではなく、既に保持している
// stripe_subscription_id を手がかりに plan / plan_expires_at を Stripe の実態へ
// 合わせ直すだけ(Webhook と同じ列・同じ判定ロジックを使う)。
export const POST = withApiHandler(
  "POST /api/billing/stripe/sync",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "ログインが必要です" },
        { status: 401 }
      );
    }

    const account = await env.DB.prepare(
      `SELECT plan_expires_at, stripe_subscription_id FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(session.accountId)
      .first<{
        plan_expires_at: string | null;
        stripe_subscription_id: string | null;
      }>();

    // Stripe で契約したことが無いアカウント(stripe_subscription_id が無い)は
    // 取り直す対象が無いので、Stripe API は一切呼ばず現在の値をそのまま返す。
    const subscription = account?.stripe_subscription_id
      ? await reconcileFromStripe(
          env,
          session.accountId,
          account.stripe_subscription_id,
          account.plan_expires_at
        )
      : null;

    const { plan, planExpiresAt } = await getAccountPlanInfo(
      session.accountId,
      env
    );

    const responseBody: StripeSyncResponse = {
      success: true,
      accountId: session.accountId,
      plan,
      planExpiresAt,
      subscription,
    };

    return Response.json(responseBody);
  }
);

async function reconcileFromStripe(
  env: CloudflareEnv,
  accountId: string,
  subscriptionId: string,
  currentPlanExpiresAt: string | null
): Promise<StripeSubscriptionSummary | null> {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let subscription: Stripe.Subscription;

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;

    // retrieve が失敗した場合、accounts は一切書き換えない。
    //  - 404(Stripe 側に該当 Subscription が無い): 契約の削除だけでなく、
    //    テスト/ライブモードの取り違え・API キーや Stripe アカウントの不一致・
    //    破損した ID でも起きる。ここでポインタ(stripe_subscription_id)を外すと、
    //    本物の削除だった場合に後続の署名検証済み customer.subscription.deleted が
    //    契約 ID でアカウントを引けなくなり、即時ダウングレードが恒久的に不発になる。
    //  - それ以外(レート制限・タイムアウト・Stripe 障害): 一時的なので次回の
    //    sync / Webhook を待てばよい。
    // どちらも「今回の同期を諦めるだけ」にし、実際の失効は deleted Webhook と
    // effectivePlan()(期限到来時の自動 free 落ち)に委ねる。
    if (statusCode === 404) {
      console.warn(
        `POST /api/billing/stripe/sync: subscription ${subscriptionId} not found on Stripe (404) for account ${accountId}; ` +
          `leaving DB state untouched (a real deletion is downgraded by the signed deleted webhook)`
      );
    } else {
      console.error(
        "POST /api/billing/stripe/sync: subscription retrieve failed:",
        error
      );
    }

    // DB 上まだ有効期限内の有料プランを持っているなら、UI が管理ブロックを
    // 出せるよう最低限の要約を返す(cancel_at_period_end までは分からないので
    // "active" 扱い)。期限切れなら null(契約フロー表示)。
    const stillPaid =
      currentPlanExpiresAt &&
      new Date(currentPlanExpiresAt).getTime() > Date.now();

    return stillPaid
      ? { state: "active", currentPeriodEnd: currentPlanExpiresAt }
      : null;
  }

  const plan = planFromSubscription(subscription, env);
  const periodEnd = getSubscriptionPeriodEnd(subscription);

  if (isActiveSubscriptionStatus(subscription.status) && plan && periodEnd) {
    const newExpiresAt = unixSecondsToIso(periodEnd);

    // plan(Price ID 由来)は常に実態へ合わせる。plan_expires_at だけは
    // 後退させない(Stripe 読み取りの一時的な遅延や、Webhook が先にもっと
    // 新しい期限を書いていた場合に、古い情報で巻き戻さないための保険)。
    // 「後退させない」判定は、reconcile 開始時に読んだ currentPlanExpiresAt
    // ではなく UPDATE 内で現在の列値に対して原子的に行う。Stripe 取得中に
    // Webhook がより新しい期限を書き込んでいても、それを古い newExpiresAt で
    // 上書きして課金済み期間を短縮しないため(Webhook 主経路の
    // `max(coalesce(plan_expires_at, ?), ?)` と揃える)。
    // WHERE に stripe_subscription_id も含めることで、この同期の実行中に
    // 別 Subscription へ切り替わった場合の取り違えを防ぐ。
    await env.DB.prepare(
      `
      UPDATE accounts
      SET plan = ?,
          plan_expires_at = max(coalesce(plan_expires_at, ?), ?)
      WHERE id = ? AND stripe_subscription_id = ?
    `
    )
      .bind(plan, newExpiresAt, newExpiresAt, accountId, subscriptionId)
      .run();
  } else if (isDeadSubscriptionStatus(subscription.status)) {
    // canceled / incomplete_expired / unpaid。Webhook の
    // customer.subscription.deleted と同じ「即時ダウングレード」を行う
    // (plan_expires_at を現在時刻に、stripe_subscription_id を外す。ただし
    // Bitcoin の期間チャージで先まで前払いされている分は残す)。
    // 期間末解約の通常フローでは、Stripe が canceled にする時点で既に
    // 期間末に達しているため実質的な差は無い。一方サポートからの即時解約
    // (返金・不正対応)の場合は、この即時ダウングレードが意図どおり。
    // ここで plan_expires_at を触らずポインタだけ外すと、後から届いた
    // deleted Webhook が突き合わせる行を失い、即時ダウングレードが
    // 恒久的に不発になってしまう。
    await downgradeExpiredCardPlan(env, { accountId, subscriptionId });
  }

  // incomplete / past_due 等の中間状態は accounts を触らない
  // (Webhook / 次回の同期を待つ)。toSubscriptionSummary() が
  // active/trialing 以外は null を返すので、UI 上は契約フロー扱いになる。
  return toSubscriptionSummary(subscription);
}
