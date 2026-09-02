import { describe, expect, it } from "vitest";
import {
  MAX_SHARE_PASSWORD_LENGTH,
  MIN_SHARE_PASSWORD_LENGTH,
  SHARE_PASSWORD_LENGTH_ERROR,
  validateSharePassword,
} from "@/lib/passwordPolicy";

describe("validateSharePassword", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const result = validateSharePassword("a".repeat(MIN_SHARE_PASSWORD_LENGTH - 1));

    expect(result).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("rejects an empty password", () => {
    expect(validateSharePassword("")).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("counts non-BMP characters as single characters", () => {
    expect(validateSharePassword("𝟙𝟚𝟛𝟜")).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("accepts a password exactly at the minimum length", () => {
    expect(
      validateSharePassword("a".repeat(MIN_SHARE_PASSWORD_LENGTH))
    ).toEqual({ ok: true });
  });

  it("accepts a password exactly at the maximum length", () => {
    expect(
      validateSharePassword("a".repeat(MAX_SHARE_PASSWORD_LENGTH))
    ).toEqual({ ok: true });
  });

  it("rejects a password longer than the maximum length", () => {
    expect(
      validateSharePassword("a".repeat(MAX_SHARE_PASSWORD_LENGTH + 1))
    ).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("counts surrounding whitespace as part of the length (does not trim)", () => {
    // 7 visible chars + 1 trailing space == minimum length: still accepted,
    // matching the account-side schema which also does not trim.
    expect(validateSharePassword("1234567 ")).toEqual({ ok: true });
    // 7 chars with no padding stays rejected.
    expect(validateSharePassword("1234567")).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("keeps the minimum in step with the account password policy", () => {
    // Accounts require 8+ (app/api/account/signup/schema.ts). If that changes,
    // this is a deliberate prompt to reconcile the two.
    expect(MIN_SHARE_PASSWORD_LENGTH).toBe(8);
  });
});
