import { describe, expect, it } from "vitest";
import {
  isValidAccountId,
  generateRecoveryCode,
  MIN_ACCOUNT_ID_LENGTH,
  MAX_ACCOUNT_ID_LENGTH,
} from "@/lib/account/id";

describe("isValidAccountId", () => {
  it("accepts an id at the minimum allowed length", () => {
    expect(isValidAccountId("a".repeat(MIN_ACCOUNT_ID_LENGTH))).toBe(true);
  });

  it("accepts an id at the maximum allowed length", () => {
    expect(isValidAccountId("a".repeat(MAX_ACCOUNT_ID_LENGTH))).toBe(true);
  });

  it("rejects an id shorter than the minimum length", () => {
    expect(isValidAccountId("a".repeat(MIN_ACCOUNT_ID_LENGTH - 1))).toBe(
      false
    );
  });

  it("rejects an id longer than the maximum length", () => {
    expect(isValidAccountId("a".repeat(MAX_ACCOUNT_ID_LENGTH + 1))).toBe(
      false
    );
  });

  it("accepts letters, numbers, hyphens, and underscores", () => {
    expect(isValidAccountId("valid-account_ID123")).toBe(true);
  });

  it("rejects characters outside the allowed set", () => {
    expect(isValidAccountId("has a space")).toBe(false);
    expect(isValidAccountId("has.dot")).toBe(false);
    expect(isValidAccountId("has/slash")).toBe(false);
    expect(isValidAccountId("日本語id")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidAccountId("")).toBe(false);
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
