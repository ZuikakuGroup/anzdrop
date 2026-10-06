import { describe, expect, it } from "vitest";
import {
  analyzeHeadingStructure,
  isHttpUrl,
  isSkippableHref,
  validateJsonLdNode,
} from "../../scripts/seo-audit-helpers.mjs";

describe("seo-audit-helpers", () => {
  it("accepts only http(s) URLs", () => {
    expect(isHttpUrl("https://anzdrop.com/about")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:3000/")).toBe(true);
    expect(isHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("skips mailto/tel/hash/javascript links", () => {
    expect(isSkippableHref("#section")).toBe(true);
    expect(isSkippableHref("mailto:support@example.com")).toBe(true);
    expect(isSkippableHref("tel:+810000000000")).toBe(true);
    expect(isSkippableHref("/about")).toBe(false);
  });

  it("detects missing, multiple, and skipped heading levels", () => {
    expect(analyzeHeadingStructure([{ level: 2, text: "x" }]).h1).toBe("missing");
    expect(
      analyzeHeadingStructure([
        { level: 1, text: "a" },
        { level: 1, text: "b" },
      ]).h1,
    ).toBe("multiple");
    expect(
      analyzeHeadingStructure([
        { level: 1, text: "a" },
        { level: 3, text: "jump" },
      ]).jumps,
    ).toEqual(["h1 → h3"]);
  });

  it("validates minimal JSON-LD shape including @graph", () => {
    expect(validateJsonLdNode({ "@context": "https://schema.org", "@type": "WebSite" })).toEqual([]);
    expect(
      validateJsonLdNode({
        "@context": "https://schema.org",
        "@graph": [{ "@type": "Organization" }],
      }),
    ).toEqual([]);
    expect(validateJsonLdNode({ "@type": "WebSite" })).toContain("missing @context");
    expect(validateJsonLdNode({ "@context": "https://schema.org" })).toContain("missing @type");
  });
});
