import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsBarChart } from "@/components/admin/AnalyticsBarChart";

describe("AnalyticsBarChart", () => {
  it("グラフのタイトルと装飾用Canvasを提供する", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsBarChart, { title: "送信件数", labels: ["送信"], values: [1] }));
    expect(html).toContain('aria-label="送信件数"');
    expect(html).toContain('<canvas aria-hidden="true"');
  });
});
