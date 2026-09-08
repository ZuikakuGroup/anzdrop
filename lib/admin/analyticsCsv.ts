import type { AnalyticsView } from "@/lib/admin/analyticsApi";

const VIEW_LABELS: Record<AnalyticsView, string> = {
  overview: "概要",
  funnel: "ファネル",
  reliability: "信頼性",
  acquisition: "流入経路",
  retention: "継続率",
  "recipient-growth": "受信→送信転換",
};

function escapeCsvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function flatten(value: unknown, path: string, rows: [string, string | number | null][]): void {
  if (value === null || typeof value === "string" || typeof value === "number") {
    rows.push([path, value]);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index + 1}]`, rows));
    return;
  }

  if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, rows));
  }
}

export function createAnalyticsCsv(
  view: AnalyticsView,
  range: { from: string; to: string },
  data: unknown
): string {
  const rows: [string, string | number | null][] = [
    ["レポート", VIEW_LABELS[view]],
    ["開始日", range.from],
    ["終了日", range.to],
  ];
  flatten(data, "集計値", rows);

  return `\uFEFF${rows.map(([label, value]) => `${escapeCsvCell(label)},${escapeCsvCell(value)}`).join("\r\n")}\r\n`;
}

export function analyticsCsvFilename(view: AnalyticsView, from: string, to: string): string {
  return `anzdrop-${view}-${from}_${to}.csv`;
}

export function createAllAnalyticsCsv(
  range: { from: string; to: string },
  reports: Record<AnalyticsView, unknown>
): string {
  const sections = (Object.keys(VIEW_LABELS) as AnalyticsView[]).map((view) =>
    createAnalyticsCsv(view, range, reports[view]).replace(/^\uFEFF/, "").trimEnd()
  );

  return `\uFEFF${sections.join("\r\n\r\n")}\r\n`;
}

export function allAnalyticsCsvFilename(from: string, to: string): string {
  return `anzdrop-analytics-${from}_${to}.csv`;
}
