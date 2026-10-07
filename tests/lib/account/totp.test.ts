import { describe, expect, it } from "vitest";
import { encodeBase32, generateTotpSecret, matchTotpStep, totpAtStep, totpUri } from "@/lib/account/totp";

const secret = encodeBase32(new TextEncoder().encode("12345678901234567890"));
describe("TOTP", () => {
  it.each([[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]])("matches RFC 6238 at %s", async (seconds, expected) => {
    expect(await totpAtStep(secret, Math.floor(Number(seconds) / 30), 8)).toBe(expected);
  });
  it("accepts only adjacent time steps and six decimal digits", async () => {
    const now = 300_000;
    for (const step of [9, 10, 11]) expect(await matchTotpStep(secret, await totpAtStep(secret, step), now)).toBe(step);
    expect(await matchTotpStep(secret, await totpAtStep(secret, 8), now)).toBeNull();
    expect(await matchTotpStep(secret, await totpAtStep(secret, 12), now)).toBeNull();
    expect(await matchTotpStep(secret, "12345", now)).toBeNull();
    expect(await matchTotpStep(secret, "1234567", now)).toBeNull();
    expect(await matchTotpStep(secret, "12a456", now)).toBeNull();
  });
  it("handles the first period and exact period boundaries", async () => {
    expect(await matchTotpStep(secret, await totpAtStep(secret, 0), 0)).toBe(0);
    expect(await matchTotpStep(secret, await totpAtStep(secret, 11), 299_999)).toBeNull();
    expect(await matchTotpStep(secret, await totpAtStep(secret, 11), 300_000)).toBe(11);
    expect(await matchTotpStep(secret, await totpAtStep(secret, 9), 330_000)).toBeNull();
  });
  it("generates a 160-bit secret and encodes the account label", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
    const uri = new URL(totpUri("alice", secret));
    expect(decodeURIComponent(uri.pathname)).toBe("/Anzdrop:alice");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("digits")).toBe("6");
  });
});
