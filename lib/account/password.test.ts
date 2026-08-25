import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(
      verifyPassword("correct horse battery staple", hash)
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(
      false
    );
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");

    expect(a).not.toBe(b);
    await expect(verifyPassword("same password", a)).resolves.toBe(true);
    await expect(verifyPassword("same password", b)).resolves.toBe(true);
  });

  it("stores the iteration count and rejects malformed stored hashes", async () => {
    const hash = await hashPassword("password");
    const [iterations] = hash.split("$");

    expect(Number(iterations)).toBeGreaterThan(0);

    await expect(verifyPassword("password", "not-a-valid-hash")).resolves.toBe(
      false
    );
    await expect(verifyPassword("password", "1$only-two-parts")).resolves.toBe(
      false
    );
  });

  it("rejects a stored hash with a non-numeric iteration count", async () => {
    await expect(
      verifyPassword("password", "abc$c2FsdA$aGFzaA")
    ).resolves.toBe(false);
  });
});
