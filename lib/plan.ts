import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import { RETENTION_DAYS, type Retention } from "@/lib/retention";

export type Plan = "free" | "standard" | "premium";

// 各プランの上限。数値は暫定値(正式な価格・容量はビジネス判断待ち)で、
// ここを変更するだけでアップロードフロー全体に反映される。
export const PLAN_LIMITS: Record<
  Plan,
  {
    maxFileSizeBytes: number;
    allowedRetentions: Retention[];
    previewEnabled: boolean;
    skipTurnstile: boolean;
    uploadConcurrency: number;
  }
> = {
  free: {
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedRetentions: ["once", "1d", "3d", "7d"],
    previewEnabled: false,
    skipTurnstile: false,
    uploadConcurrency: 8,
  },
  standard: {
    maxFileSizeBytes: 20 * 1024 * 1024 * 1024, // 20GB
    allowedRetentions: ["once", "1d", "3d", "7d", "15d"],
    previewEnabled: false,
    skipTurnstile: true,
    uploadConcurrency: 8,
  },
  premium: {
    maxFileSizeBytes: 50 * 1024 * 1024 * 1024, // 50GB(暫定)
    allowedRetentions: ["once", "1d", "3d", "7d", "15d", "30d"],
    previewEnabled: true,
    skipTurnstile: true,
    uploadConcurrency: 12,
  },
};

// BillingPage・(将来の)PricingPageで使い回す表示用の単一の情報源。
export const PLAN_LABELS: Record<Plan, string> = {
  free: "無料プラン",
  standard: "Standardプラン",
  premium: "Premiumプラン",
};

// Bitcoinは参考価格のため、月額表示はJPY建てのここだけを正とする。
export const PLAN_MONTHLY_PRICE_JPY: Record<Exclude<Plan, "free">, number> = {
  standard: 250,
  premium: 450,
};

// 現在購入できる有料プラン。購入UI(components/billing/BillingPage.tsx)と
// 決済API(app/api/billing/stripe/subscription・app/api/billing/btc/charge)が
// 共有する単一の情報源。Standardは提供準備中(Issue #5)のため含めない。
// スキーマ・APIルート・環境変数(STRIPE_PRICE_ID_STANDARD 等)はStandardも
// 扱える状態のまま残してあるので、提供開始時はこの配列へ "standard" を戻すだけで
// 購入UI・Stripe/Bitcoinの両決済APIに反映される。
export const PURCHASABLE_PLANS = ["premium"] as const satisfies readonly Exclude<
  Plan,
  "free"
>[];

export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];

export function isPurchasablePlan(value: string): value is PurchasablePlan {
  return (PURCHASABLE_PLANS as readonly string[]).includes(value);
}

// プランの階層順序。Bitcoin決済のWebhook確定処理で、既にアクティブな上位
// プラン(例: premium)を、より安価なプラン(例: standard)の支払いで
// 誤って格下げしないための比較に使う。
export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  standard: 1,
  premium: 2,
};

// /adminからの手動付与で「無期限」を表すための番兵的な有効期限。有料プランは
// 常にplan_expires_atで期限管理する設計(effectivePlan()が期限切れを自動的に
// free扱いにする)のため、「無期限」も専用の状態を増やさず、実運用で到達しない
// 遠い未来の日付をplan_expires_atへ格納することで表現する。
export const INDEFINITE_PLAN_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

// plan_expires_atが上記の番兵値かどうか。/adminのプラン表示で「無期限」と
// 具体的な期限日を出し分けるために使う。
export function isIndefinitePlanExpiry(planExpiresAt: string | null): boolean {
  return planExpiresAt === INDEFINITE_PLAN_EXPIRES_AT;
}

export function getMaxFileSizeBytes(plan: Plan): number {
  return PLAN_LIMITS[plan].maxFileSizeBytes;
}

// そのプランで選べる最長の保存期間(日数)。"once"はダウンロード後即削除の
// 安全弁として7日が入っているだけで、ユーザーが「保存期間」として選ぶものでは
// ないため除外する。free=7 / standard=15 / premium=30。/mypageのプラン内容表示で使う。
export function getMaxRetentionDays(plan: Plan): number {
  return Math.max(
    ...PLAN_LIMITS[plan].allowedRetentions
      .filter((retention): retention is Exclude<Retention, "once"> =>
        retention !== "once"
      )
      .map((retention) => RETENTION_DAYS[retention])
  );
}

export function isRetentionAllowedForPlan(
  retention: Retention,
  plan: Plan
): boolean {
  return PLAN_LIMITS[plan].allowedRetentions.includes(retention);
}

// ブラウザ内プレビュー(lib/preview.ts)を利用できるプランか。共有作成時に
// 一度だけ判定しshares.preview_allowedへ焼き込む(expires_atと同じ方式)。
export function isPreviewAllowedForPlan(plan: Plan): boolean {
  return PLAN_LIMITS[plan].previewEnabled;
}

// Turnstile認証(app/api/upload/start)が必要なプランか。Standard/Premiumは
// 既にログイン済みアカウントであることが分かっているためスキップする。
export function isTurnstileRequiredForPlan(plan: Plan): boolean {
  return !PLAN_LIMITS[plan].skipTurnstile;
}

// アップロードチャンクの並列送信数(lib/upload/chunkUploader.ts)。
export function getUploadConcurrencyForPlan(plan: Plan): number {
  return PLAN_LIMITS[plan].uploadConcurrency;
}

// DBの生の文字列値をPlan型へ正規化する唯一の境界。"paid"は3値化前の旧値で、
// 仕様上Premium相当の内容(50GB/30日/プレビュー可)だったため"premium"として
// 扱う(migrations/0013で値自体もpremiumへ書き換えるが、デプロイ順序に対して
// 安全にするためコード側でも防御的にエイリアスする)。未知の値はfreeへ倒す。
export function normalizeStoredPlan(rawPlan: string): Plan {
  if (rawPlan === "standard" || rawPlan === "premium") {
    return rawPlan;
  }

  if (rawPlan === "paid") {
    return "premium";
  }

  return "free";
}

// アカウントの有料期限(plan_expires_at)を見て、実効プランを判定する。
// 期限切れならDB上の値がまだ有料プランでもfree扱いにする(Bitcoin決済は
// 自動更新されないため、この判定が唯一の「失効」チェックになる)。
export function effectivePlan(
  plan: Plan,
  planExpiresAt: string | null
): Plan {
  if (plan === "free") {
    return "free";
  }

  if (!planExpiresAt) {
    return "free";
  }

  return new Date(planExpiresAt).getTime() > Date.now() ? plan : "free";
}

// Bitcoin「期間チャージ」の適用: 既に有効期限が未来にある場合はそこに積み増し、
// 既に失効している(または初めての)場合は「今から」を起点に延長する。
export function extendPaidPeriod(
  currentPlanExpiresAt: string | null,
  days: number
): string {
  const now = Date.now();
  const currentExpiry = currentPlanExpiresAt
    ? new Date(currentPlanExpiresAt).getTime()
    : now;
  const base = Math.max(now, currentExpiry);

  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

// カード契約が終端(Webhookの customer.subscription.deleted、または sync が読み取る
// canceled / unpaid / incomplete_expired)に達したときの「即時ダウングレード」。
// 追跡用の stripe_subscription_id を外し、plan / plan_expires_at を「カードが
// 無くなった後に実際に有効な状態」へ合わせ直す。
//
// カードが終端に達したあと有効期間を支えるのは Bitcoin の「期間チャージ」だけなので、
//   - plan_expires_at: まだ期限が未来にある 'paid' な btc_payments の最も遠い
//     extends_plan_until。無ければ現在時刻(＝即時失効)。
//   - plan: そのまだ有効な 'paid' な btc_payments が支払った最上位のプラン
//     (btc_payments.plan)。無ければ free。
//
// これにより「カードで premium 契約中にカードが dunning → その間に standard を
// Bitcoin で前払い → カード終端」というケースで、standard 分しか支払っていないのに
// premium が残り続けることを防ぐ。カードと Bitcoin を同時には持たせない運用でも、
// 「カード期間末解約 → その後 Bitcoin で前払い → カード期間末に deleted が届く」
// という切り替えの順序では両方の情報が一時的に accounts に載るため、この整理が要る。
//
// なお extends_plan_until には「カードの請求期間末 + Bitcoin の日数」が入っている
// (extendPaidPeriod が既存の期限に積み増すため)。カードのチャージバック・返金で
// 即時失効させたい不正対応では、この「カード期間分」まで残ってしまう。その場合は
// サポートが accounts.plan_expires_at を手で戻す(docs/accounts.md 参照)。
export async function downgradeExpiredCardPlan(
  env: CloudflareEnv,
  match: { subscriptionId: string; accountId?: string }
): Promise<void> {
  const nowIso = new Date().toISOString();

  const accountId =
    match.accountId ??
    (
      await env.DB.prepare(
        `SELECT id FROM accounts WHERE stripe_subscription_id = ? LIMIT 1`
      )
        .bind(match.subscriptionId)
        .first<{ id: string }>()
    )?.id;

  if (!accountId) {
    return;
  }

  // まだ期限が未来にある(＝消費し切っていない) 'paid' な Bitcoin 前払いだけを見る。
  const { results: liveBtcPayments } = await env.DB.prepare(
    `
    SELECT plan, extends_plan_until
    FROM btc_payments
    WHERE account_id = ?
      AND status = 'paid'
      AND extends_plan_until IS NOT NULL
      AND extends_plan_until > ?
  `
  )
    .bind(accountId, nowIso)
    .all<{ plan: string; extends_plan_until: string }>();

  let nextExpiresAt = nowIso;
  let nextPlan: Plan = "free";

  for (const payment of liveBtcPayments) {
    if (payment.extends_plan_until > nextExpiresAt) {
      nextExpiresAt = payment.extends_plan_until;
    }

    const paidPlan = normalizeStoredPlan(payment.plan);

    if (PLAN_RANK[paidPlan] > PLAN_RANK[nextPlan]) {
      nextPlan = paidPlan;
    }
  }

  // WHERE に stripe_subscription_id も含め、id 特定後にアカウントが別の
  // Subscription へ切り替わっていた場合の取り違えを防ぐ(sync と揃える)。
  await env.DB.prepare(
    `
    UPDATE accounts
    SET plan = ?, plan_expires_at = ?, stripe_subscription_id = NULL
    WHERE id = ? AND stripe_subscription_id = ?
  `
  )
    .bind(nextPlan, nextExpiresAt, accountId, match.subscriptionId)
    .run();
}

export type AccountPlanInfo = {
  plan: Plan; // 実効プラン(期限切れは自動的にfreeへ)
  planExpiresAt: string | null;
};

const FREE_PLAN_INFO: AccountPlanInfo = { plan: "free", planExpiresAt: null };

// セッションが無い(未ログイン)・アカウントが見つからない場合は常にfree。
// アップロード系ルート(app/api/upload/start, app/api/upload/complete)と
// app/api/account/me の両方から共通で呼ばれる想定。
export async function getAccountPlanInfo(
  accountId: string | null,
  env: CloudflareEnv
): Promise<AccountPlanInfo> {
  if (!accountId) {
    return FREE_PLAN_INFO;
  }

  const account = await env.DB.prepare(
    `SELECT plan, plan_expires_at FROM accounts WHERE id = ? LIMIT 1`
  )
    .bind(accountId)
    .first<{ plan: string; plan_expires_at: string | null }>();

  if (!account) {
    return FREE_PLAN_INFO;
  }

  return {
    plan: effectivePlan(
      normalizeStoredPlan(account.plan),
      account.plan_expires_at
    ),
    planExpiresAt: account.plan_expires_at,
  };
}
