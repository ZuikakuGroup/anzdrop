import { describe, expect, it } from "vitest";
import { sanitizeArticleHtml } from "@/lib/blog/sanitize";

describe("sanitizeArticleHtml", () => {
  it("keeps safe article markup and hardens blank-target links", () => {
    const result = sanitizeArticleHtml('<h2>見出し</h2><a href="https://example.com" target="_blank">link</a>');
    expect(result).toContain("<h2>見出し</h2>");
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("removes executable markup and unsafe URLs", () => {
    const result = sanitizeArticleHtml('<script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src="https://evil.example/image.png">');
    expect(result).not.toContain("script");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("evil.example");
  });

  it("allows only microCMS hosted images", () => {
    expect(sanitizeArticleHtml('<img src="https://images.microcms-assets.io/assets/a.png" alt="A">')).toContain("images.microcms-assets.io");
  });
});
