import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SiteHeader from "@/components/brand/SiteHeader";

// SiteHeader は "use client" だが、非UIロジックを lib/ に切り出す規模でも
// ないため、描画結果そのものを react-dom/server で検証する（新しいテスト
// 依存は追加しない）。useEffect は静的描画では走らないので
// fetch("/api/account/me") は呼ばれず、認証状態に依存しない共通ナビだけを
// 対象にできる。
function renderHeader(): string {
  return renderToStaticMarkup(createElement(SiteHeader));
}

// 共通ヘッダーは PC 中央ナビとモバイルメニューで別々の <nav> を持ち、
// どちらも同じ NAV_LINKS を map する。両方に反映されていることを確かめる
// ため、<nav> ブロックを個別に取り出す。
function navBlocks(html: string): string[] {
  return [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map((m) => m[0]);
}

describe("SiteHeader のナビゲーション", () => {
  it("問い合わせリンクが PC 中央ナビとモバイルメニューの両方に描画される", () => {
    const navs = navBlocks(renderHeader());

    // PC 中央ナビ + モバイルメニューの 2 つ。
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(nav).toContain('href="/contact"');
      expect(nav).toContain(">問い合わせ</a>");
    }
  });

  it("問い合わせリンク追加後も既存の About・料金プランのリンクが残っている", () => {
    const navs = navBlocks(renderHeader());

    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(nav).toContain('href="/about"');
      expect(nav).toContain(">Anzdropとは</a>");
      expect(nav).toContain('href="/pricing"');
      expect(nav).toContain(">料金プラン</a>");
    }
  });

  it("認証確認が終わるまではログイン系のリンクを出さない（静的描画の前提）", () => {
    // このテストは fetch をモックせず静的描画に依存している。その前提は
    // 「isAuthChecked が false の間はログイン中/未ログインどちらのUIも
    // 出さない」こと。ここが崩れると fetch モックが必要になるため、
    // 前提が壊れたことを検知できるようにしておく。
    const html = renderHeader();
    expect(html).not.toContain('href="/mypage/login"');
    expect(html).not.toContain('href="/mypage/signup"');
    expect(html).not.toContain("ログアウト");
  });
});
