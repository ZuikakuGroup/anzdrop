// /admin の問い合わせ・通報一覧で共有する、解決状態フィルタ。
export type AdminStatusFilter = "open" | "resolved" | "all";

export function parseAdminStatusFilter(
  value: string | null
): AdminStatusFilter {
  if (value === "resolved" || value === "all") {
    return value;
  }

  return "open";
}

// resolved_at 列を持つテーブル向けの WHERE 句。
export function resolvedAtWhereClause(status: AdminStatusFilter): string {
  if (status === "resolved") {
    return "WHERE resolved_at IS NOT NULL";
  }

  if (status === "all") {
    return "";
  }

  return "WHERE resolved_at IS NULL";
}
