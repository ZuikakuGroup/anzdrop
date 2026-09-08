import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminAnalyticsPage, {
  formatDeviceClass,
  formatFunnelStepName,
  ScrollableTable,
} from "@/components/admin/AdminAnalyticsPage";

describe("AdminAnalyticsPage", () => {
  it("分析レポートの切替ボタンと初期選択状態を支援技術へ伝える", () => {
    const html = renderToStaticMarkup(createElement(AdminAnalyticsPage));

    const analyticsNav = html.match(
      /<nav\b[^>]*aria-label="分析レポートの種類"[^>]*>([\s\S]*?)<\/nav>/
    );

    expect(analyticsNav?.[1]).toBeDefined();
    expect((analyticsNav?.[1].match(/aria-pressed=/g) ?? [])).toHaveLength(6);
    expect((analyticsNav?.[1].match(/aria-pressed="true"/g) ?? [])).toHaveLength(1);
    expect((analyticsNav?.[1].match(/aria-pressed="false"/g) ?? [])).toHaveLength(5);
    expect(analyticsNav?.[1]).toMatch(
      /<button\b[^>]*aria-pressed="true"[^>]*>概要<\/button>/
    );
  });

  it("横スクロール表をキーボードで操作できるようにする", () => {
    const html = renderToStaticMarkup(
      createElement(
        ScrollableTable,
        { label: "ファネルの表" },
        createElement("table")
      )
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="ファネルの表"');
    expect(html).toContain("overflow-x-auto");
  });

  it("ファネルの内部イベント名を管理画面向けの日本語にする", () => {
    expect(formatFunnelStepName("landing_view")).toBe("ページ表示");
    expect(formatFunnelStepName("file_select")).toBe("ファイル選択");
    expect(formatFunnelStepName("upload_start")).toBe("アップロード開始");
    expect(formatFunnelStepName("upload_success")).toBe("アップロード完了");
    expect(formatFunnelStepName("share")).toBe("共有");
    expect(formatFunnelStepName("download_success")).toBe("ダウンロード完了");
  });

  it("端末種別を管理画面向けの日本語にする", () => {
    expect(formatDeviceClass("desktop")).toBe("パソコン");
    expect(formatDeviceClass("mobile")).toBe("スマートフォン");
    expect(formatDeviceClass("tablet")).toBe("タブレット");
    expect(formatDeviceClass("unknown")).toBe("不明");
  });
});
