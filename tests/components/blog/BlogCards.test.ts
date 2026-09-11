import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogPostCard } from "@/components/blog/BlogCards";
import type { BlogPost } from "@/lib/blog/types";

const post: BlogPost = {
  id: "post-id",
  title: "記事タイトル",
  excerpt: "記事の概要です。",
  body: "<p>本文</p>",
  eyecatch: { url: "https://example.com/eyecatch.png", alt: "アイキャッチ" },
  category: { id: "category-id", name: "ファイル転送", description: "" },
  tags: [],
  author: { id: "author-id", name: "著者", bio: "", image: { url: "https://example.com/author.png" } },
  publishedAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

describe("BlogPostCard", () => {
  it("カード全体を記事への単一リンクにし、16:9画像とカードホバー時の拡大を提供する", () => {
    const html = renderToStaticMarkup(createElement(BlogPostCard, { post }));

    expect(html.match(/href="\/blog\/post-id"/g)).toHaveLength(1);
    expect(html).not.toContain('href="/blog/categories/category-id"');
    expect(html).toContain("aspect-video");
    expect(html).toContain("group-hover:scale-[1.05]");
    expect(html).not.toContain("hover:underline");
  });
});
