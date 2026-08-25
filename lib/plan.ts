import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import type { Retention } from "@/lib/retention";

export type Plan = "free" | "paid";

// 各プランの上限。数値は暫定値(正式な価格・容量はビジネス判断待ち)で、
// ここを変更するだけでアップロードフロー全体に反映される。
export const PLAN_LIMITS: Record<
  Plan,
  {
    maxFileSizeBytes: number;
    allowedRetentions: Retention[];
    previewEnabled: boolean;
  }
> = {
  free: {
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedRetentions: ["once", "1d", "3d", "7d"],
    previewEnabled: false,
  },
  paid: {
    maxFileSizeBytes: 50 * 1024 * 1024 * 1024, // 50GB(暫定)
    allowedRetentions: ["once", "1d", "3d", "7d", "30d"],
    previewEnabled: true,
  },
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

// アカウントの有料期限(plan_expires_at)を見て、実効プランを判定する。
// 期限切れならDB上の値がまだ"paid"でもfree扱いにする(Bitcoin決済は
// 自動更新されないため、この判定が唯一の「失効」チェックになる)。
export function effectivePlan(
  plan: Plan,
  planExpiresAt: string | null
): Plan {
  if (plan !== "paid") {
    return "free";
  }

  if (!planExpiresAt) {
    return "free";
  }

  return new Date(planExpiresAt).getTime() > Date.now() ? "paid" : "free";
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
    .first<{ plan: Plan; plan_expires_at: string | null }>();

  if (!account) {
    return FREE_PLAN_INFO;
  }

  return {
    plan: effectivePlan(account.plan, account.plan_expires_at),
    planExpiresAt: account.plan_expires_at,
  };
}
