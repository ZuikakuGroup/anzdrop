import { describe, expect, it } from "vitest";
import { encryptAuthSecret, decryptAuthSecret } from "@/lib/account/authEncryption";
import { encodeBase64Url } from "@/lib/crypto/base64";

const key = encodeBase64Url(new Uint8Array(32).fill(7));
describe("account auth secret encryption", () => {
  it("round trips with a fresh nonce without exposing the secret", async () => {
    const encrypted = await encryptAuthSecret("OTPSECRET", "alice", "totp", key);
    expect(encrypted).not.toContain("OTPSECRET");
    expect(await decryptAuthSecret(encrypted, "alice", "totp", key)).toBe("OTPSECRET");
    expect(await encryptAuthSecret("OTPSECRET", "alice", "totp", key)).not.toBe(encrypted);
  });
  it("rejects another account, purpose, key and corrupted ciphertext", async () => {
    const encrypted = await encryptAuthSecret("OTPSECRET", "alice", "totp", key);
    await expect(decryptAuthSecret(encrypted, "bob", "totp", key)).rejects.toThrow();
    await expect(decryptAuthSecret(encrypted, "alice", "totp-setup", key)).rejects.toThrow();
    await expect(decryptAuthSecret(encrypted, "alice", "totp", encodeBase64Url(new Uint8Array(32)))).rejects.toThrow();
    await expect(decryptAuthSecret(encrypted.slice(0, -3) + "AAA", "alice", "totp", key)).rejects.toThrow();
  });
  it("fails closed with absent or malformed key", async () => {
    for (const invalid of ["", "a", "!".repeat(43)]) await expect(encryptAuthSecret("secret", "alice", "totp", invalid)).rejects.toThrow();
  });
  it("rejects malformed encryption envelopes", async () => {
    const encrypted = await encryptAuthSecret("secret", "alice", "totp", key);
    const [, iv, ciphertext] = encrypted.split(".");
    for (const malformed of [`v2.${iv}.${ciphertext}`, `v1.${iv}`, `${encrypted}.extra`, `v1.YQ.${ciphertext}`]) {
      await expect(decryptAuthSecret(malformed, "alice", "totp", key)).rejects.toThrow();
    }
  });
});
