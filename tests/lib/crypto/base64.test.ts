import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64";

describe("encodeBase64Url / decodeBase64Url", () => {
  it("round-trips arbitrary binary data", () => {
    const original = crypto.getRandomValues(new Uint8Array(257));

    const encoded = encodeBase64Url(original);
    const decoded = new Uint8Array(decodeBase64Url(encoded));

    expect(decoded).toEqual(original);
  });

  it("round-trips every possible byte value (0-255)", () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    const decoded = new Uint8Array(decodeBase64Url(encodeBase64Url(original)));

    expect(decoded).toEqual(original);
  });

  it("round-trips an empty buffer", () => {
    const decoded = new Uint8Array(decodeBase64Url(encodeBase64Url(new Uint8Array(0))));

    expect(decoded).toEqual(new Uint8Array(0));
  });

  it("produces URL-safe output with no padding, +, or / characters", () => {
    // Feed enough random data across many trials to hit every base64 alphabet
    // position, since a single sample may not contain a '+' or '/' char.
    for (let trial = 0; trial < 50; trial++) {
      const data = crypto.getRandomValues(new Uint8Array(64));
      const encoded = encodeBase64Url(data);

      expect(encoded).not.toMatch(/[+/=]/);
    }
  });

  it("round-trips correctly regardless of input length mod 3 (padding edge cases)", () => {
    for (const length of [1, 2, 3, 4, 5, 6, 7, 30, 31, 32]) {
      const original = crypto.getRandomValues(new Uint8Array(length));
      const decoded = new Uint8Array(decodeBase64Url(encodeBase64Url(original)));

      expect(decoded).toEqual(original);
    }
  });
});
