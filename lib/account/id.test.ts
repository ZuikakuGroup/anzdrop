import { describe, expect, it } from "vitest";
import { generateAccountId, generateRecoveryCode } from "./id";

describe("generateAccountId", () => {
  it("generates a 16-character id", () => {
    expect(generateAccountId()).toHaveLength(16);
  });

  it("generates different ids on each call", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => generateAccountId())
    );

    expect(ids.size).toBe(50);
  });
});

describe("generateRecoveryCode", () => {
  it("generates a non-empty, URL-safe string", () => {
    const code = generateRecoveryCode();

    expect(code.length).toBeGreaterThan(0);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates different codes on each call", () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => generateRecoveryCode())
    );

    expect(codes.size).toBe(50);
  });
});
