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

// 「まだ管理対象として生きている」サブスクリプションのステータスか。
// active/trialing(課金が有効)に加えて past_due(更新 dunning 中。お支払い方法の
// 更新か自動更新の停止をユーザーが選べる)も含む。incomplete(初回未確定)や
// canceled/incomplete_expired/unpaid(終端)は含まない。
// /mypage/billing の契約管理フロー表示(toSubscriptionSummary)と、/admin の
// プラン管理画面が出す「Stripe サブスクリプション紐づき」警告の両方で使う。
export function isManageableSubscriptionStatus(
  status: Stripe.Subscription.Status
): boolean {
  return isActiveSubscriptionStatus(status) || status === "past_due";
}

// クライアント(/mypage/billing)へ返す、現在のサブスクリプションの要約。
// メールを収集しない方針のため、期限切れ・解約はすべてこの画面上の表示で
// 伝えるしかない。DBへ保存する情報ではなく、都度Stripeから取り直す。
export type StripeSubscriptionSummary = {
  // "active": カードでの自動更新が有効
  // "canceling": 期間末で終了予定(自動更新は停止済み。期間末まではプラン有効)
  // "past_due": 更新の支払いに失敗して dunning リトライ中。お支払い方法の
  //   更新(サポート対応)か、自動更新の停止(解約)をユーザーが選べる状態。
  //   この状態のときは currentPeriodEnd は常に null(下記参照)。
  state: "active" | "canceling" | "past_due";
  currentPeriodEnd: string | null;
};

// active/trialing に加えて past_due(更新 dunning 中)も UI の管理対象として
// 扱う。past_due で null を返すと画面上は契約フローになるが、そこからの新規
// 作成も subscription ルートが 409 で止めるため、解約もできない行き止まりに
// なる。incomplete(初回未確定)・canceled 等の未開始/終端状態は引き続き null。
export function toSubscriptionSummary(
  subscription: Stripe.Subscription
): StripeSubscriptionSummary | null {
  if (!isManageableSubscriptionStatus(subscription.status)) {
    return null;
  }

  // past_due の間は current_period_end を「有効期限」として扱わない。更新
  // インボイスの生成時点で Stripe が請求期間を次期(未払い分)へ前進させる
  // ことがあり、支払い済みの期限より先の日付を指しうるため。実際に払い込み
  // 済みの期限は accounts.plan_expires_at 側にあり、そちらは past_due では
  // Webhook も sync も更新しない。
  const periodEnd =
    subscription.status === "past_due"
      ? null
      : getSubscriptionPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd ? unixSecondsToIso(periodEnd) : null;

  if (subscription.cancel_at_period_end) {
    return { state: "canceling", currentPeriodEnd };
  }

  return {
    state: subscription.status === "past_due" ? "past_due" : "active",
    currentPeriodEnd,
  };
}
