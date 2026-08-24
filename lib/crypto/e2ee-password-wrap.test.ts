import { describe, expect, it } from "vitest";
import {
  deriveKeyFromPassword,
  exportKey,
  generateKey,
  generateSalt,
  importKey,
} from "./key";
import { encryptChunk } from "./encrypt";
import { decryptChunk } from "./decrypt";
import { packChunk, unpackChunk } from "./packet";

// These tests exercise the real "password-protected share" flow used by
// UploadForm/DownloadPage: the actual file-encryption key is never sent to
// the server in the clear. Instead it is wrapped (encrypted) with a key
// derived from the sender's password via PBKDF2, and the server only ever
// stores the wrapped bytes + salt. This is the crux of Anzdrop's E2EE
// promise for password-protected shares -- a compromised server must not be
// able to recover file contents without the password, which never leaves
// the client.

async function wrapKey(fileKey: CryptoKey, password: string) {
  const salt = generateSalt();
  const kek = await deriveKeyFromPassword(password, salt);

  const rawFileKey = await exportKey(fileKey);
  const encrypted = await encryptChunk(rawFileKey, kek);
  const wrapped = packChunk(encrypted);

  return { wrapped, salt };
}

async function unwrapKey(
  wrapped: Uint8Array,
  salt: Uint8Array,
  password: string
): Promise<CryptoKey> {
  const kek = await deriveKeyFromPassword(password, salt);
  const { iv, ciphertext } = unpackChunk(wrapped);
  const rawFileKey = await decryptChunk(ciphertext, iv, kek);

  return importKey(rawFileKey);
}

describe("password-based key wrapping (E2EE core: wrap/unwrap the file key)", () => {
  it("unwraps to a key that correctly decrypts data encrypted with the original file key", async () => {
    const fileKey = await generateKey();
    const password = "correct horse battery staple";

    const { wrapped, salt } = await wrapKey(fileKey, password);
    const recoveredKey = await unwrapKey(wrapped, salt, password);

    const plaintext = new TextEncoder().encode("top secret file contents");
    const { iv, ciphertext } = await encryptChunk(plaintext, fileKey);
    const decrypted = await decryptChunk(ciphertext, iv, recoveredKey);

    expect(new TextDecoder().decode(decrypted)).toBe("top secret file contents");
  });

  it("fails to unwrap (throws) with the wrong password -- server compromise alone must not reveal file contents", async () => {
    const fileKey = await generateKey();
    const { wrapped, salt } = await wrapKey(fileKey, "the-real-password");

    await expect(unwrapKey(wrapped, salt, "a-guessed-password")).rejects.toThrow();
  });

  it("fails to unwrap with an off-by-one wrong password", async () => {
    const fileKey = await generateKey();
    const { wrapped, salt } = await wrapKey(fileKey, "password1234");

    await expect(unwrapKey(wrapped, salt, "password123")).rejects.toThrow();
  });

  it("fails to unwrap when the wrong salt is supplied (simulates a corrupted/mismatched DB row)", async () => {
    const fileKey = await generateKey();
    const password = "shared-secret";
    const { wrapped } = await wrapKey(fileKey, password);

    const wrongSalt = generateSalt();

    await expect(unwrapKey(wrapped, wrongSalt, password)).rejects.toThrow();
  });

  it("fails to unwrap when the wrapped-key bytes are tampered with", async () => {
    const fileKey = await generateKey();
    const password = "tamper-test-password";
    const { wrapped, salt } = await wrapKey(fileKey, password);

    const tampered = new Uint8Array(wrapped);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(unwrapKey(tampered, salt, password)).rejects.toThrow();
  });

  it("produces different wrapped bytes each time even for the same key+password (fresh salt and IV per share)", async () => {
    const fileKey = await generateKey();
    const password = "same-password-both-times";

    const first = await wrapKey(fileKey, password);
    const second = await wrapKey(fileKey, password);

    expect(Buffer.from(first.wrapped).toString("hex")).not.toBe(
      Buffer.from(second.wrapped).toString("hex")
    );
    expect(Buffer.from(first.salt).toString("hex")).not.toBe(
      Buffer.from(second.salt).toString("hex")
    );

    // But both must still correctly unwrap with the right password.
    const recoveredFirst = await unwrapKey(first.wrapped, first.salt, password);
    const recoveredSecond = await unwrapKey(second.wrapped, second.salt, password);

    const plaintext = new TextEncoder().encode("consistency check");
    for (const recovered of [recoveredFirst, recoveredSecond]) {
      const { iv, ciphertext } = await encryptChunk(plaintext, fileKey);
      const decrypted = await decryptChunk(ciphertext, iv, recovered);
      expect(new TextDecoder().decode(decrypted)).toBe("consistency check");
    }
  });

  it("a party that only has server-stored data (wrapped key + salt), without the password, cannot derive any working key by brute-guessing a wrong password", async () => {
    const fileKey = await generateKey();
    const realPassword = "genuinely-random-password-9f8a";
    const { wrapped, salt } = await wrapKey(fileKey, realPassword);

    const attackerGuesses = ["", "password", "123456", "genuinely-random-password-9f8"];

    for (const guess of attackerGuesses) {
      await expect(unwrapKey(wrapped, salt, guess)).rejects.toThrow();
    }
  });
});
