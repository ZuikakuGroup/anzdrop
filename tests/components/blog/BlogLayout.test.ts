import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlogLayout from "@/components/blog/BlogLayout";

describe("BlogLayout", () => {
  it("他ページと同様にヘッダーを除く表示領域をmainの最小高として確保する", () => {
    const html = renderToStaticMarkup(createElement(BlogLayout, null, "記事一覧"));

    expect(html).toContain('class="min-h-[calc(100svh-4rem)] flex-1');
  });
});
