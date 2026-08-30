import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import type { RouteContext } from "@/lib/api/types";
import {
  effectivePlan,
  INDEFINITE_PLAN_EXPIRES_AT,
  isIndefinitePlanExpiry,
  normalizeStoredPlan,
} from "@/lib/plan";
import {
  GrantPlanRequestSchema,
  type AdminAccountInfo,
  type AdminAccountResponse,
} from "@/app/api/admin/accounts/[accountId]/schema";

type AccountRow = {
  plan: string;
  plan_expires_at: string | null;
  stripe_subscription_id: string | null;
};

const MISSING_ACCOUNT_INFO: AdminAccountInfo = {
  exists: false,
  storedPlan: "free",
  effectivePlan: "free",
  planExpiresAt: null,
  indefinite: false,
  hasStripeSubscription: false,
};

async function fetchAccountRow(
  env: CloudflareEnv,
  accountId: string
): Promise<AccountRow | null> {
  return env.DB.prepare(
    `SELECT plan, plan_expires_at, stripe_subscription_id FROM accounts WHERE id = ? LIMIT 1`
  )
    .bind(accountId)
    .first<AccountRow>();
}

function toAccountInfo(row: AccountRow): AdminAccountInfo {
  const storedPlan = normalizeStoredPlan(row.plan);

  return {
    exists: true,
    storedPlan,
    effectivePlan: effectivePlan(storedPlan, row.plan_expires_at),
    planExpiresAt: row.plan_expires_at,
    indefinite: isIndefinitePlanExpiry(row.plan_expires_at),
    hasStripeSubscription: row.stripe_subscription_id !== null,
  };
}

function accountResponse(account: AdminAccountInfo): Response {
  const body: AdminAccountResponse = { success: true, account };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

// アカウントIDを指定して現在のプラン状況を取得する。読み取り専用のためOrigin検証は行わない。
export const GET = withApiHandler(
  "GET /api/admin/accounts/[accountId]",
  async (
    request: Request,
    context: RouteContext<{ accountId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env, { verifyOrigin: false });

    if (!auth.ok) {
      return auth.response;
    }

    const { accountId } = await context.params;
    const row = await fetchAccountRow(env, accountId);

    return accountResponse(row ? toAccountInfo(row) : MISSING_ACCOUNT_INFO);
  }
);

// アカウントIDを指定してStandard/Premiumを付与する。既存のaccounts.plan /
// plan_expires_atを更新するだけで、新しい種類の情報は保存しない。
export const POST = withApiHandler(
  "POST /api/admin/accounts/[accountId]",
  async (
    request: Request,
    context: RouteContext<{ accountId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseJsonBody(request, GrantPlanRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { plan, expiresAt } = parsed.data;

    // expiresAtが指定されている場合は未来である必要がある。過去の日付を
    // 受け付けると、付与した瞬間にeffectivePlan()でfree扱いになる。
    if (expiresAt !== null && new Date(expiresAt).getTime() <= Date.now()) {
      return Response.json(
        { success: false, error: "有効期限には未来の日時を指定してください" },
        { status: 400 }
      );
    }

    const { accountId } = await context.params;
    const row = await fetchAccountRow(env, accountId);

    if (!row) {
      return Response.json(
        { success: false, error: "アカウントが見つかりません" },
        { status: 404 }
      );
    }

    // plan_expires_at は全書き込み経路で toISOString() の固定フォーマットに
    // 揃える(Stripe Webhook / sync の "後退させない" ガードが SQLite の文字列
    // 辞書順比較で時刻比較を代用しているため)。スキーマは日付として解釈可能で
    // あることしか見ないので、ここで正規化してからバインドする。
    const nextExpiresAt =
      expiresAt === null
        ? INDEFINITE_PLAN_EXPIRES_AT
        : new Date(expiresAt).toISOString();

    // admin の明示指定をそのまま反映する(意図的な格下げ・期限短縮も許す)。
    // 他の書き込み経路のような max() ガードは掛けない。Stripe Webhook と競合
    // した場合は last-writer-wins だが、手動操作のため許容する。
    await env.DB.prepare(
      `UPDATE accounts SET plan = ?, plan_expires_at = ? WHERE id = ?`
    )
      .bind(plan, nextExpiresAt, accountId)
      .run();

    const updated = await fetchAccountRow(env, accountId);

    return accountResponse(updated ? toAccountInfo(updated) : MISSING_ACCOUNT_INFO);
  }
);

// アカウントを無料プランへ戻す(誤付与の取り消し・不正対応)。plan='free' /
// plan_expires_at=NULLにするだけ。stripe_subscription_idは外さないため、
// 有効なカード契約があるアカウントでは次回のsync/Webhookで再度有効化されうる
// (その場合はStripe側で解約する)。
export const DELETE = withApiHandler(
  "DELETE /api/admin/accounts/[accountId]",
  async (
    request: Request,
    context: RouteContext<{ accountId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const { accountId } = await context.params;
    const row = await fetchAccountRow(env, accountId);

    if (!row) {
      return Response.json(
        { success: false, error: "アカウントが見つかりません" },
        { status: 404 }
      );
    }

    await env.DB.prepare(
      `UPDATE accounts SET plan = 'free', plan_expires_at = NULL WHERE id = ?`
    )
      .bind(accountId)
      .run();

    const updated = await fetchAccountRow(env, accountId);

    return accountResponse(updated ? toAccountInfo(updated) : MISSING_ACCOUNT_INFO);
  }
);
