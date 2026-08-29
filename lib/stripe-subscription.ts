import type Stripe from "stripe";
import type { Plan } from "@/lib/plan";

// Stripe SubscriptionをAnzdropのプラン状態へ落とし込む際の共通処理。
// Webhook(app/api/billing/stripe/webhook)と、Webhook不達の保険である
// 同期エンドポイント(app/api/billing/stripe/sync)の両方から使う。

export function unixSecondsToIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

// 現在の請求期間の終了時刻。Stripeの新しいAPIバージョンではSubscription直下では
// なく各SubscriptionItemに付く(複数アイテムがそれぞれ別サイクルを持てるように
// なったため)。このアプリは1サブスクリプションにつき1アイテムのみ使うので、
// 先頭アイテムの値をそのまま使う。
export function getSubscriptionPeriodEnd(
  subscription: Stripe.Subscription
): number | null {
  return subscription.items.data[0]?.current_period_end ?? null;
}

// SubscriptionのPrice IDから、どのプランかを判定する。metadataではなく実際の
// Price IDを正とすることで、Stripeカスタマーポータル等で後からプランが変更
// された場合にも自動追従できる。未知のPrice IDはnullを返し、呼び出し元で
// 更新をスキップする(意図しないプラン活性化を防ぐ防御的な扱い)。
export function planFromSubscription(
  subscription: Stripe.Subscription,
  env: CloudflareEnv
): Plan | null {
  const priceId = subscription.items.data[0]?.price?.id;

  if (priceId === env.STRIPE_PRICE_ID_STANDARD) {
    return "standard";
  }

  if (priceId === env.STRIPE_PRICE_ID_PREMIUM) {
    return "premium";
  }

  return null;
}

// 有料プランを付与してよい(課金が有効な)ステータスか。
export function isActiveSubscriptionStatus(
  status: Stripe.Subscription.Status
): boolean {
  return status === "active" || status === "trialing";
}

// もう二度と有効化されない終端ステータスか(呼び出し元で
// accounts.stripe_subscription_idの追跡を外す・ダウングレードする判断に使う)。
export function isDeadSubscriptionStatus(
  status: Stripe.Subscription.Status
): boolean {
  return (
    status === "canceled" ||
    status === "incomplete_expired" ||
    status === "unpaid"
  );
}

// クライアント(/mypage/billing)へ返す、現在のサブスクリプションの要約。
// メールを収集しない方針のため、期限切れ・解約はすべてこの画面上の表示で
// 伝えるしかない。DBへ保存する情報ではなく、都度Stripeから取り直す。
export type StripeSubscriptionSummary = {
  // "active": カードでの自動更新が有効
  // "canceling": 期間末で終了予定(自動更新は停止済み。期間末まではプラン有効)
  state: "active" | "canceling";
  currentPeriodEnd: string | null;
};

// active/trialing のSubscriptionだけをUIの管理対象として扱う。それ以外
// (incomplete・past_due・canceled 等)はnullを返し、契約フローを見せる。
export function toSubscriptionSummary(
  subscription: Stripe.Subscription
): StripeSubscriptionSummary | null {
  if (!isActiveSubscriptionStatus(subscription.status)) {
    return null;
  }

  const periodEnd = getSubscriptionPeriodEnd(subscription);

  return {
    state: subscription.cancel_at_period_end ? "canceling" : "active",
    currentPeriodEnd: periodEnd ? unixSecondsToIso(periodEnd) : null,
  };
}
