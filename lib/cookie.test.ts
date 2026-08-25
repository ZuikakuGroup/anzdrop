import { describe, expect, it } from "vitest";
import { extractCookie, buildSetCookie } from "./cookie";

describe("extractCookie", () => {
  it("returns null when the header is missing", () => {
    expect(extractCookie(null, "foo")).toBeNull();
  });

  it("returns null when the named cookie is absent", () => {
    expect(extractCookie("a=1; b=2", "c")).toBeNull();
  });

  it("extracts the value among multiple cookies", () => {
    expect(extractCookie("a=1; b=2; c=3", "b")).toBe("2");
  });

  it("trims surrounding whitespace around names and values", () => {
    expect(extractCookie("a=1;  b = 2 ; c=3", "b")).toBe("2");
  });
});

describe("buildSetCookie", () => {
  it("includes HttpOnly, Secure, and SameSite=Strict by default", () => {
    const header = buildSetCookie("session", "token123");

    expect(header).toContain("session=token123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("Max-Age");
  });

  it("includes Max-Age when provided", () => {
    const header = buildSetCookie("session", "token123", 3600);

    expect(header).toContain("Max-Age=3600");
  });

  it("supports Max-Age=0 for immediate expiry", () => {
    const header = buildSetCookie("session", "", 0);

    expect(header).toContain("Max-Age=0");
  });
});
