import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlogLayout from "@/components/blog/BlogLayout";

describe("BlogLayout", () => {
  it("main は flex-1 で伸縮し、フッター分の余計な縦スクロールを生む最小高を持たない", () => {
    const html = renderToStaticMarkup(createElement(BlogLayout, null, "記事一覧"));

    expect(html).toContain('class="flex min-h-screen flex-col"');
    expect(html).toMatch(/<main class="[^"]*\bflex-1\b/);
    expect(html).not.toContain("min-h-[calc(100svh-4rem)]");
  });
});
