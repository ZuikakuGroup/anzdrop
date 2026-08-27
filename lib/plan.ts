import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import type { Retention } from "@/lib/retention";

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

// プランの階層順序。Bitcoin決済のWebhook確定処理で、既にアクティブな上位
// プラン(例: premium)を、より安価なプラン(例: standard)の支払いで
// 誤って格下げしないための比較に使う。
export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  standard: 1,
  premium: 2,
};

export function getMaxFileSizeBytes(plan: Plan): number {
  return PLAN_LIMITS[plan].maxFileSizeBytes;
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
function normalizeStoredPlan(rawPlan: string): Plan {
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
