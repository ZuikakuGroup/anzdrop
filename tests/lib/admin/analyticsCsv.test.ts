import { describe, expect, it } from "vitest";
import { allAnalyticsCsvFilename, analyticsCsvFilename, createAllAnalyticsCsv, createAnalyticsCsv } from "@/lib/admin/analyticsCsv";

describe("createAnalyticsCsv", () => {
  it("期間と集計値をBOM付きCSVへ変換し、数式として解釈される値を無害化する", () => {
    const csv = createAnalyticsCsv(
      "acquisition",
      { from: "2026-09-01", to: "2026-09-02" },
      { rows: [{ source: "\t=malicious", sessions: 2 }] }
    );

    expect(csv).toContain("\uFEFF");
    expect(csv).toContain('"開始日","2026-09-01"');
    expect(csv).toContain('"集計値.rows[1].source","\'\t=malicious"');
    expect(analyticsCsvFilename("funnel", "2026-09-01", "2026-09-02")).toBe("anzdrop-funnel-2026-09-01_2026-09-02.csv");
  });
});

describe("createAllAnalyticsCsv", () => {
  it("全レポートを一つのCSVへ出力する", () => {
    const reports = {
      overview: {}, funnel: {}, reliability: {}, acquisition: {}, retention: {}, "recipient-growth": {},
    };
    const csv = createAllAnalyticsCsv({ from: "2026-09-01", to: "2026-09-02" }, reports);

    expect(csv).toContain('"レポート","概要"');
    expect(csv).toContain('"レポート","受信→送信転換"');
    expect(allAnalyticsCsvFilename("2026-09-01", "2026-09-02")).toBe("anzdrop-analytics-2026-09-01_2026-09-02.csv");
  });
});
