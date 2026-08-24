import { describe, expect, it } from "vitest";
import { generateShareId } from "./id";

describe("generateShareId", () => {
  it("is exactly 10 characters long", () => {
    expect(generateShareId()).toHaveLength(10);
  });

  it("only uses nanoid's URL-safe alphabet (no characters needing percent-encoding)", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateShareId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
    }
  });

  it("does not collide across many generations", () => {
    const seen = new Set<string>();
    const iterations = 2000;

    for (let i = 0; i < iterations; i++) {
      seen.add(generateShareId());
    }

    expect(seen.size).toBe(iterations);
  });
});
