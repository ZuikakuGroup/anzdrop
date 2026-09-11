import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlogAuthor } from "@/lib/blog/types";

vi.mock("server-only", () => ({}));

vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    createElement("img", { src, alt, className }),
}));

const getAuthor = vi.fn();
const getAllPosts = vi.fn();

vi.mock("@/lib/blog/client", () => ({
  getAuthor: (...args: unknown[]) => getAuthor(...args),
  getAllPosts: (...args: unknown[]) => getAllPosts(...args),
  isMicrocmsNotFoundError: () => false,
}));

const author: BlogAuthor = {
  id: "author-id",
  name: "著者名",
  bio: "1行目\n2行目",
  image: { url: "https://example.com/author.png" },
};

describe("著者ページ", () => {
  beforeEach(() => {
    getAuthor.mockReset();
    getAllPosts.mockReset();
    getAuthor.mockResolvedValue(author);
    getAllPosts.mockResolvedValue([]);
  });

  it("著者 bio の改行を whitespace-pre-wrap で保持する", async () => {
    getAuthor.mockResolvedValue({
      ...author,
      bio: "1行目\n2行目<script>alert(1)</script>",
    });

    const { default: Page } = await import("@/app/blog/authors/[slug]/page");
    const element = await Page({ params: Promise.resolve({ slug: author.id }) });
    const html = renderToStaticMarkup(element);

    expect(html).toMatch(/<p class="[^"]*\bwhitespace-pre-wrap\b[^"]*">1行目\n2行目&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
