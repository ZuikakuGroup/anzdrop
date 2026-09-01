import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SiteFooter from "@/components/brand/SiteFooter";

function render(props: { reportShareId?: string } = {}) {
  return renderToStaticMarkup(createElement(SiteFooter, props));
}

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

// 正規表現メタ文字(バックスラッシュを含む)をすべてエスケープする。
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("SiteFooter", () => {
  it("フッターの全リンクを既定の href でレンダリングする", () => {
    const markup = render();

    // 利用規約・プライバシーポリシー・特商法表記・問題を報告・お問い合わせは
    // 全ページ共通フッターの必須リンク。どれか欠けると法的表示やサポート導線が
    // 失われる。
    const expected: Record<string, string> = {
      利用規約: "/legal/terms",
      プライバシーポリシー: "/legal/privacy",
      特定商取引法に基づく表記: "/legal/tokushoho",
      問題を報告: "/report",
      お問い合わせ: "/contact",
    };

    for (const [label, href] of Object.entries(expected)) {
      expect(markup).toContain(`>${label}</a>`);
      expect(markup).toMatch(
        new RegExp(`href="${escapeRegExp(href)}"[^>]*>${escapeRegExp(label)}</a>`)
      );
    }

    // 想定外のリンク先が紛れ込んでいないこと。
    expect(hrefs(markup).sort()).toEqual(
      Object.values(expected).sort()
    );
  });

  it("reportShareId が渡されると『問題を報告』が該当共有の /report へ向く", () => {
    const markup = render({ reportShareId: "abc123" });

    expect(markup).toMatch(
      /href="\/report\?shareId=abc123"[^>]*>問題を報告<\/a>/
    );
    // 他のリンクは影響を受けない。
    expect(markup).toContain('href="/contact"');
    expect(markup).toContain('href="/legal/terms"');
  });

  it("reportShareId が空文字なら shareId を付けず /report へ向く", () => {
    // download ページ側で shareId が空になったときに
    // /report?shareId= という空クエリを吐かないこと。
    const markup = render({ reportShareId: "" });

    expect(markup).toMatch(/href="\/report"[^>]*>問題を報告<\/a>/);
    expect(markup).not.toContain("shareId=");
  });

  it("reportShareId を URL エンコードして XSS やクエリ汚染を防ぐ", () => {
    const markup = render({ reportShareId: 'x"&y z/?#' });

    const reportHref = hrefs(markup).find((href) =>
      href.startsWith("/report")
    );
    expect(reportHref).toBe(
      `/report?shareId=${encodeURIComponent('x"&y z/?#')}`
    );
    // 生のダブルクォートが属性値へ漏れていない。
    expect(markup).not.toContain('shareId=x"');
  });

  it("ブランド表記・サービス説明・著作権表記を含む", () => {
    const markup = render();

    expect(markup).toContain("Anzdrop");
    expect(markup).toContain("© Anzdrop");
    expect(markup).toContain("エンドツーエンド暗号化の匿名ファイル共有");
    // フッター要素かつナビゲーションのラベルを持つ。
    expect(markup).toMatch(/^<footer/);
    expect(markup).toContain('aria-label="フッター"');
  });

  it("リンクを見出し付きのグループに分け、各リストへ見出しを関連付ける", () => {
    const markup = render();

    for (const heading of ["規約・法的情報", "サポート"]) {
      expect(markup).toContain(heading);
    }

    // 各グループの見出しは id を持ち、対応する <ul> から
    // aria-labelledby で参照されている(スクリーンリーダーでの文脈維持)。
    const headingIds = [
      ...markup.matchAll(/<p id="(site-footer-[^"]+)"/g),
    ].map((match) => match[1]);
    expect(headingIds).toEqual(["site-footer-legal", "site-footer-support"]);

    for (const id of headingIds) {
      expect(markup).toContain(`<ul aria-labelledby="${id}"`);
    }

    // フッターの見出しはページ本文のアウトラインを汚さないよう
    // <h1>〜<h6> にしない。
    expect(markup).not.toMatch(/<h[1-6][ >]/);
  });
});
