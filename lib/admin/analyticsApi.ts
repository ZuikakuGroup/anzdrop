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
  let result: AnalyticsApiResponse<V>;

  try {
    result = (await response.json()) as AnalyticsApiResponse<V>;
  } catch {
    throw new Error(
      response.ok
        ? "サーバーから正しい応答を受信できませんでした。"
        : `読み込みに失敗しました。(HTTP ${response.status})`
    );
  }

  if (typeof result !== "object" || result === null) {
    throw new Error("サーバーから正しい応答を受信できませんでした。");
  }

  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.error ?? "読み込みに失敗しました。");
  }

  return result.data;
}
