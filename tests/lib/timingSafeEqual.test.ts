import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "@/lib/timingSafeEqual";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("timingSafeEqual", () => {
  it("returns true for identical byte arrays", () => {
    expect(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
  });

  it("returns true for two empty arrays", () => {
    expect(timingSafeEqual(bytes(), bytes())).toBe(true);
  });

  it("returns false when a single byte differs", () => {
    expect(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
  });

  it("returns false when the first byte differs", () => {
    expect(timingSafeEqual(bytes(9, 2, 3), bytes(1, 2, 3))).toBe(false);
  });

  it("returns false for arrays of different lengths, even when one is a prefix of the other", () => {
    expect(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2))).toBe(false);
    expect(timingSafeEqual(bytes(1, 2), bytes(1, 2, 3))).toBe(false);
  });

  it("does not treat all-zero input as trivially unequal or equal to unrelated data", () => {
    expect(timingSafeEqual(bytes(0, 0, 0), bytes(0, 0, 0))).toBe(true);
    expect(timingSafeEqual(bytes(0, 0, 0), bytes(0, 0, 1))).toBe(false);
  });
});
