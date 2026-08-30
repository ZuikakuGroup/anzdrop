import type {
  AdminAccountInfo,
  AdminAccountResponse,
} from "@/app/api/admin/accounts/[accountId]/schema";

export type { AdminAccountInfo };

export type GrantPlan = "standard" | "premium";

function accountPath(accountId: string): string {
  return `/api/admin/accounts/${encodeURIComponent(accountId)}`;
}

async function readAccountResponse(
  response: Response,
  fallbackMessage: string
): Promise<AdminAccountInfo> {
  const result: AdminAccountResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(
      (!result.success && result.error) || fallbackMessage
    );
  }

  return result.account;
}

export async function fetchAccount(
  accountId: string
): Promise<AdminAccountInfo> {
  const response = await fetch(accountPath(accountId));

  return readAccountResponse(response, "アカウントの取得に失敗しました。");
}

export async function grantPlan(
  accountId: string,
  input: { plan: GrantPlan; expiresAt: string | null }
): Promise<AdminAccountInfo> {
  const response = await fetch(accountPath(accountId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return readAccountResponse(response, "プランの付与に失敗しました。");
}

export async function revokePlan(
  accountId: string
): Promise<AdminAccountInfo> {
  const response = await fetch(accountPath(accountId), { method: "DELETE" });

  return readAccountResponse(response, "無料プランへの変更に失敗しました。");
}
