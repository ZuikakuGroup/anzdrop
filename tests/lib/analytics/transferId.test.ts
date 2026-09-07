import { describe, expect, it } from "vitest";
import { computeAnalyticsTransferId } from "@/lib/analytics/transferId";

describe("computeAnalyticsTransferId", () => {
  it("is deterministic for the same shareId and secret", async () => {
    const a = await computeAnalyticsTransferId("share-abc", "secret-1");
    const b = await computeAnalyticsTransferId("share-abc", "secret-1");

    expect(a).toBe(b);
  });

  it("produces a different value for a different secret", async () => {
    const a = await computeAnalyticsTransferId("share-abc", "secret-1");
    const b = await computeAnalyticsTransferId("share-abc", "secret-2");

    expect(a).not.toBe(b);
  });

  it("produces a different value for a different shareId", async () => {
    const a = await computeAnalyticsTransferId("share-abc", "secret-1");
    const b = await computeAnalyticsTransferId("share-xyz", "secret-1");

    expect(a).not.toBe(b);
  });

  it("does not leak the shareId in the output (not a substring)", async () => {
    const result = await computeAnalyticsTransferId("share-abc", "secret-1");

    expect(result).not.toContain("share-abc");
  });

  it("returns a 64-character lowercase hex digest (HMAC-SHA256)", async () => {
    const result = await computeAnalyticsTransferId("share-abc", "secret-1");

    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws instead of silently deriving a key from an empty/missing secret", async () => {
    await expect(computeAnalyticsTransferId("share-abc", "")).rejects.toThrow(
      "ANALYTICS_SECRET is not configured"
    );
  });
});
