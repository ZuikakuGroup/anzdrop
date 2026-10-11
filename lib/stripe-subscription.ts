import type Stripe from "stripe";
import type { Plan } from "@/lib/plan";

// Stripe SubscriptionをAnzdropのプラン状態へ落とし込む際の共通処理。
// Webhook(server/routes/billing/stripe/webhook)と、Webhook不達の保険である
// 同期エンドポイント(server/routes/billing/stripe/sync)の両方から使う。

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

// 初回支払いが一度も確定しないまま失効した Subscription か(status だけ見られる場合)。
// 「決済フォームを開いただけ」のゴミポインタ掃除には使うが、
// plan / plan_expires_at は触らない(admin 付与や Bitcoin 前払いを消さない)。
//
// incomplete を明示 cancel したときの status は canceled になるため、status だけでは
// 判別できない。そのケースは shouldOnlyClearSubscriptionPointer() を使う。
export function isNeverActivatedSubscriptionStatus(
  status: Stripe.Subscription.Status
): boolean {
  return status === "incomplete_expired";
}

// ゴミポインタ掃除だけで plan / plan_expires_at を維持すべき Subscription か。
//  - incomplete / incomplete_expired: 初回支払い未確定
//  - canceled かつ trial も支払いも一度も無い: incomplete を cancel したゴミ
//    (subscription ルートが新規作成前に cancel したとき等)。canceled でも
//    かつて active/trialing だった契約の終端は false(＝即時ダウングレード対象)。
//  - unpaid: 更新 dunning を尽くした終端なので常に false
//
// latest_invoice が ID だけのときは Stripe から取り直す。取得に失敗したら throw
// し、呼び出し側で「今回は触らない / 再送に賭ける」を選ばせる。
export async function shouldOnlyClearSubscriptionPointer(
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<boolean> {
  if (
    subscription.status === "incomplete" ||
    subscription.status === "incomplete_expired"
  ) {
    return true;
  }

  if (subscription.status !== "canceled") {
    return false;
  }

  // trial 開始済みなら一度は有効化されている(無料トライアル終了後の cancel 含む)。
  if (subscription.trial_start != null) {
    return false;
  }

  const latest = subscription.latest_invoice;

  if (latest == null) {
    // 請求書が無い canceled は、支払い確定前に消えたゴミとみなす。
    return true;
  }

  const invoice =
    typeof latest === "string"
      ? await stripe.invoices.retrieve(latest)
      : latest;

  if (invoice.status === "paid" || (invoice.amount_paid ?? 0) > 0) {
    return false;
  }

  // 初回作成インボイスが未払いのまま終端 → incomplete を cancel したゴミ。
  // 更新サイクル等(subscription_cycle / subscription_update など)の未払い
  // インボイスがある場合は、かつて有効だった契約の終端なのでダウングレード対象。
  // (unpaid を cancel したあとの canceled や、past_due 後の canceled を
  // ポインタ掃除だけにして plan を残さないため。)
  return invoice.billing_reason === "subscription_create";
}

// もう二度と有効化されない終端ステータスか(呼び出し元で
// accounts.stripe_subscription_idの追跡を外す・ダウングレードする判断に使う)。
// incomplete_expired はポインタ掃除だけでプランを落とさないため含めない
// (isNeverActivatedSubscriptionStatus を参照)。
export function isDeadSubscriptionStatus(
  status: Stripe.Subscription.Status
): boolean {
  return status === "canceled" || status === "unpaid";
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
