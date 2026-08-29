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

    // 404(Stripe 側に該当 Subscription が無い。削除済み等)は追跡対象から外す。
    // plan / plan_expires_at はここでは触らず、期限が来れば effectivePlan() が
    // 自動的に free へ倒す。
    if (statusCode === 404) {
      await clearSubscriptionPointer(env, accountId, subscriptionId);
      return null;
    }

    // それ以外(レート制限・タイムアウト・Stripe 障害等)は、今回の同期を
    // 諦めるだけで失敗にはしない。DB 上まだ有効期限内の有料プランを持って
    // いるなら、UI が管理ブロックを出せるよう最低限の要約を返す
    // (cancel_at_period_end までは分からないので "active" 扱い)。
    console.error(
      "POST /api/billing/stripe/sync: subscription retrieve failed:",
      error
    );

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
    const nextExpiresAt =
      !currentPlanExpiresAt ||
      new Date(newExpiresAt).getTime() >=
        new Date(currentPlanExpiresAt).getTime()
        ? newExpiresAt
        : currentPlanExpiresAt;

    // WHERE に stripe_subscription_id も含めることで、この同期の実行中に
    // 別 Subscription へ切り替わった場合の取り違えを防ぐ。
    await env.DB.prepare(
      `
      UPDATE accounts
      SET plan = ?, plan_expires_at = ?
      WHERE id = ? AND stripe_subscription_id = ?
    `
    )
      .bind(plan, nextExpiresAt, accountId, subscriptionId)
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

async function clearSubscriptionPointer(
  env: CloudflareEnv,
  accountId: string,
  subscriptionId: string
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE accounts
    SET stripe_subscription_id = NULL
    WHERE id = ? AND stripe_subscription_id = ?
  `
  )
    .bind(accountId, subscriptionId)
    .run();
}
