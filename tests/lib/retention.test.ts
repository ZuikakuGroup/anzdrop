import { describe, expect, it } from "vitest";
import {
  RETENTION_DAYS,
  calculateExpiresAt,
  isRetention,
  maxDownloadsForRetention,
} from "@/lib/retention";

describe("isRetention", () => {
  it("accepts every known retention value", () => {
    for (const value of Object.keys(RETENTION_DAYS)) {
      expect(isRetention(value)).toBe(true);
    }
  });

  it("rejects unknown strings, non-strings, and empty values", () => {
    expect(isRetention("99d")).toBe(false);
    expect(isRetention("")).toBe(false);
    expect(isRetention(undefined)).toBe(false);
    expect(isRetention(null)).toBe(false);
    expect(isRetention(7)).toBe(false);
    expect(isRetention({ value: "7d" })).toBe(false);
  });
});

describe("calculateExpiresAt", () => {
  it("adds the correct number of days for each retention tier", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    expect(calculateExpiresAt(createdAt, "1d")).toBe(
      "2026-01-02T00:00:00.000Z"
    );
    expect(calculateExpiresAt(createdAt, "3d")).toBe(
      "2026-01-04T00:00:00.000Z"
    );
    expect(calculateExpiresAt(createdAt, "7d")).toBe(
      "2026-01-08T00:00:00.000Z"
    );
    expect(calculateExpiresAt(createdAt, "15d")).toBe(
      "2026-01-16T00:00:00.000Z"
    );
    expect(calculateExpiresAt(createdAt, "30d")).toBe(
      "2026-01-31T00:00:00.000Z"
    );
  });

  it("treats 'once' as a 7-day safety-net expiry, not an immediate one", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    expect(calculateExpiresAt(createdAt, "once")).toBe(
      "2026-01-08T00:00:00.000Z"
    );
  });

  it("is correct across a month/year boundary", () => {
    const createdAt = new Date("2026-12-30T12:00:00.000Z");

    expect(calculateExpiresAt(createdAt, "3d")).toBe(
      "2027-01-02T12:00:00.000Z"
    );
  });
});

describe("maxDownloadsForRetention", () => {
  it("limits 'once' shares to a single download", () => {
    expect(maxDownloadsForRetention("once")).toBe(1);
  });

  it("leaves every other retention tier unlimited (null)", () => {
    expect(maxDownloadsForRetention("1d")).toBeNull();
    expect(maxDownloadsForRetention("3d")).toBeNull();
    expect(maxDownloadsForRetention("7d")).toBeNull();
    expect(maxDownloadsForRetention("15d")).toBeNull();
    expect(maxDownloadsForRetention("30d")).toBeNull();
  });
});
