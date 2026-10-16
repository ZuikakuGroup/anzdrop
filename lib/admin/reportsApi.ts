import { requestJson } from "@/lib/api/client";
import type { ShareInfo } from "./reportLabels";
import type { AdminStatusFilter } from "@/lib/admin/statusFilter";

export type StatusFilter = AdminStatusFilter;

export type AdminReport = {
  id: string;
  shareId: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  reportType: string;
  claimantName: string | null;
  contactEmail: string | null;
  rightType: string | null;
  category: string;
  share: ShareInfo;
};

type ReportsResponse = {
  success: boolean;
  reports?: AdminReport[];
  error?: string;
};

type ActionResponse = {
  success: boolean;
  error?: string;
};

export async function fetchReports(status: StatusFilter): Promise<AdminReport[]> {
  const result = await requestJson<ReportsResponse>(`/api/admin/reports?status=${status}`, undefined, "読み込みに失敗しました。");
  if (!result.reports) throw new Error(result.error ?? "読み込みに失敗しました。");
  return result.reports;
}

export async function resolveReport(reportId: string): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/reports/${reportId}/resolve`, { method: "POST" }, "更新に失敗しました。");
}

export async function deleteShare(shareId: string): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/shares/${shareId}`, { method: "DELETE" }, "削除に失敗しました。");
}

export async function toggleShareSuspend(shareId: string, suspend: boolean): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/shares/${shareId}/${suspend ? "suspend" : "unsuspend"}`, { method: "POST" }, "更新に失敗しました。");
}

type ShareInfoResponse = { success: boolean; share?: ShareInfo; error?: string };

export async function fetchShareInfo(shareId: string): Promise<ShareInfo> {
  const result = await requestJson<ShareInfoResponse>(`/api/admin/shares/${encodeURIComponent(shareId)}`, undefined, "読み込みに失敗しました。");
  if (!result.share) throw new Error(result.error ?? "読み込みに失敗しました。");
  return result.share;
}

export async function deleteReport(reportId: string): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/reports/${reportId}`, { method: "DELETE" }, "削除に失敗しました。");
}
