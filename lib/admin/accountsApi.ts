import { requestJson } from "@/lib/api/client";
import type {
  AdminAccountInfo,
  AdminAccountResponse,
} from "@/lib/api/schemas/admin/accounts/[accountId]/schema";

export type { AdminAccountInfo };

export type GrantPlan = "standard" | "premium";

function accountPath(accountId: string): string {
  return `/api/admin/accounts/${encodeURIComponent(accountId)}`;
}

export async function fetchAccount(
  accountId: string
): Promise<AdminAccountInfo> {
  const result = await requestJson<AdminAccountResponse>(accountPath(accountId), undefined, "アカウントの取得に失敗しました。");
  return result.account;
}

export async function grantPlan(
  accountId: string,
  input: { plan: GrantPlan; expiresAt: string | null }
): Promise<AdminAccountInfo> {
  const result = await requestJson<AdminAccountResponse>(accountPath(accountId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "プランの付与に失敗しました。");
  return result.account;
}

export async function revokePlan(
  accountId: string
): Promise<AdminAccountInfo> {
  const result = await requestJson<AdminAccountResponse>(accountPath(accountId), { method: "DELETE" }, "無料プランへの変更に失敗しました。");
  return result.account;
}
