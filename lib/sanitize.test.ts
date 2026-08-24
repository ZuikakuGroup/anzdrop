import { describe, expect, it } from "vitest";
import { stripUrlFragments } from "./sanitize";

describe("stripUrlFragments", () => {
  it("removes the fragment from a share URL, dropping the decryption key", () => {
    expect(
      stripUrlFragments("https://example.com/d/abc123#XyZ_-9AbCdEf")
    ).toBe("https://example.com/d/abc123");
  });

  it("removes fragments from multiple URLs in the same text", () => {
    const input =
      "見て https://example.com/d/aaa#key1 と https://example.com/d/bbb#key2 です";

    expect(stripUrlFragments(input)).toBe(
      "見て https://example.com/d/aaa と https://example.com/d/bbb です"
    );
  });

  it("leaves text without a URL fragment unchanged", () => {
    expect(stripUrlFragments("https://example.com/d/abc123 を報告します")).toBe(
      "https://example.com/d/abc123 を報告します"
    );
    expect(stripUrlFragments("普通の理由のテキストです")).toBe(
      "普通の理由のテキストです"
    );
  });

  it("removes fragments regardless of scheme case", () => {
    expect(stripUrlFragments("HTTPS://example.com/d/abc123#key")).toBe(
      "HTTPS://example.com/d/abc123"
    );
  });

  it("does not touch a '#' that is not part of a URL", () => {
    expect(stripUrlFragments("issue #123 について")).toBe(
      "issue #123 について"
    );
    expect(
      stripUrlFragments("https://example.com/d/abc123 # これは鍵ではない")
    ).toBe("https://example.com/d/abc123 # これは鍵ではない");
  });
});
