import type {
  AcquisitionRow,
  FunnelReport,
  OverviewReport,
  RecipientGrowthReport,
  ReliabilityReport,
  RetentionReport,
} from "@/lib/analytics/reports";

export type AnalyticsView =
  | "overview"
  | "funnel"
  | "reliability"
  | "acquisition"
  | "retention"
  | "recipient-growth";

type ViewDataMap = {
  overview: OverviewReport;
  funnel: FunnelReport;
  reliability: ReliabilityReport;
  acquisition: { rows: AcquisitionRow[] };
  retention: RetentionReport;
  "recipient-growth": RecipientGrowthReport;
};

type AnalyticsApiResponse<V extends AnalyticsView> = {
  success: boolean;
  view?: V;
  from?: string;
  to?: string;
  data?: ViewDataMap[V];
  error?: string;
};

export async function fetchAnalytics<V extends AnalyticsView>(
  view: V,
  range?: { from: string; to: string }
): Promise<ViewDataMap[V]> {
  const params = new URLSearchParams({ view });

  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }

  const response = await fetch(`/api/admin/analytics?${params.toString()}`);
  const result: AnalyticsApiResponse<V> = await response.json();

  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.error ?? "読み込みに失敗しました。");
  }

  return result.data;
}
