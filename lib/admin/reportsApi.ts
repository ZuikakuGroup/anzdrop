import type { ShareInfo } from "./reportLabels";

export type StatusFilter = "open" | "resolved" | "all";

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

export async function fetchReports(
  status: StatusFilter
): Promise<AdminReport[]> {
  const response = await fetch(`/api/admin/reports?status=${status}`);
  const result: ReportsResponse = await response.json();

  if (!response.ok || !result.success || !result.reports) {
    throw new Error(result.error ?? "読み込みに失敗しました。");
  }

  return result.reports;
}

export async function resolveReport(reportId: string): Promise<void> {
  const response = await fetch(`/api/admin/reports/${reportId}/resolve`, {
    method: "POST",
  });
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "更新に失敗しました。");
  }
}

export async function deleteShare(shareId: string): Promise<void> {
  const response = await fetch(`/api/admin/shares/${shareId}`, {
    method: "DELETE",
  });
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "削除に失敗しました。");
  }
}

export async function toggleShareSuspend(
  shareId: string,
  suspend: boolean
): Promise<void> {
  const response = await fetch(
    `/api/admin/shares/${shareId}/${suspend ? "suspend" : "unsuspend"}`,
    { method: "POST" }
  );
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "更新に失敗しました。");
  }
}

type ShareInfoResponse = {
  success: boolean;
  share?: ShareInfo;
  error?: string;
};

export async function fetchShareInfo(shareId: string): Promise<ShareInfo> {
  const response = await fetch(`/api/admin/shares/${encodeURIComponent(shareId)}`);
  const result: ShareInfoResponse = await response.json();

  if (!response.ok || !result.success || !result.share) {
    throw new Error(result.error ?? "読み込みに失敗しました。");
  }

  return result.share;
}

export async function deleteReport(reportId: string): Promise<void> {
  const response = await fetch(`/api/admin/reports/${reportId}`, {
    method: "DELETE",
  });
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "削除に失敗しました。");
  }
}
