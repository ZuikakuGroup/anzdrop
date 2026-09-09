import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "@/lib/blog/validation";

describe("isAllowedExternalUrl", () => {
  it("allows only HTTP(S) URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/profile")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/profile")).toBe(true);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,test")).toBe(false);
  });
});
