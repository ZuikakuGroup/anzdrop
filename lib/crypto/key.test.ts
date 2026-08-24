import { describe, expect, it } from "vitest";
import {
  deriveKeyFromPassword,
  exportKey,
  generateIV,
  generateKey,
  generateSalt,
  importKey,
} from "./key";
import { AES_KEY_LENGTH, IV_LENGTH, PBKDF2_SALT_LENGTH } from "./types";

describe("generateKey / exportKey / importKey", () => {
  it("generates an AES-256-GCM key usable for both encrypt and decrypt", async () => {
    const key = await generateKey();

    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyGenParams).length).toBe(AES_KEY_LENGTH);
    expect(key.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
  });

  it("generates cryptographically distinct keys on each call", async () => {
    const [a, b] = await Promise.all([generateKey(), generateKey()]);

    const [rawA, rawB] = await Promise.all([exportKey(a), exportKey(b)]);

    expect(rawA).not.toEqual(rawB);
  });

  it("exportKey produces exactly 32 bytes (256 bits) of raw key material", async () => {
    const key = await generateKey();
    const raw = await exportKey(key);

    expect(raw.byteLength).toBe(32);
  });

  it("importKey(exportKey(key)) round-trips to a functionally identical key", async () => {
    const key = await generateKey();
    const raw = await exportKey(key);

    const reimported = await importKey(raw.buffer as ArrayBuffer);

    const plaintext = new TextEncoder().encode("round-trip check");
    const iv = generateIV();
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      reimported,
      encrypted
    );

    expect(new TextDecoder().decode(decrypted)).toBe("round-trip check");
  });
});

describe("generateIV", () => {
  it("produces IV_LENGTH bytes", () => {
    expect(generateIV().byteLength).toBe(IV_LENGTH);
  });

  it("never repeats across many calls (nonce reuse would break AES-GCM confidentiality)", () => {
    const seen = new Set<string>();
    const iterations = 2000;

    for (let i = 0; i < iterations; i++) {
      const iv = generateIV();
      seen.add(Buffer.from(iv).toString("hex"));
    }

    expect(seen.size).toBe(iterations);
  });
});

describe("generateSalt", () => {
  it("produces PBKDF2_SALT_LENGTH bytes", () => {
    expect(generateSalt().byteLength).toBe(PBKDF2_SALT_LENGTH);
  });

  it("never repeats across many calls", () => {
    const seen = new Set<string>();
    const iterations = 500;

    for (let i = 0; i < iterations; i++) {
      seen.add(Buffer.from(generateSalt()).toString("hex"));
    }

    expect(seen.size).toBe(iterations);
  });
});

describe("deriveKeyFromPassword", () => {
  it("is deterministic: same password + same salt always derives the same key", async () => {
    const salt = generateSalt();

    const keyA = await deriveKeyFromPassword("correct horse battery staple", salt);
    const keyB = await deriveKeyFromPassword("correct horse battery staple", salt);

    // CryptoKey objects are opaque and non-extractable by design (see below),
    // so we verify "same key" behaviorally: ciphertext produced with keyA
    // must be decryptable by keyB.
    const iv = generateIV();
    const plaintext = new TextEncoder().encode("determinism check");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA, plaintext);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyB, encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe("determinism check");
  });

  it("derives a non-extractable key (raw bytes can never leave the crypto boundary)", async () => {
    const key = await deriveKeyFromPassword("hunter2", generateSalt());

    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("derives different keys for different passwords with the same salt", async () => {
    const salt = generateSalt();

    const keyA = await deriveKeyFromPassword("password-one", salt);
    const keyB = await deriveKeyFromPassword("password-two", salt);

    const iv = generateIV();
    const plaintext = new TextEncoder().encode("secret payload");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA, plaintext);

    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyB, encrypted)
    ).rejects.toThrow();
  });

  it("derives different keys for the same password with different salts", async () => {
    const keyA = await deriveKeyFromPassword("same-password", generateSalt());
    const keyB = await deriveKeyFromPassword("same-password", generateSalt());

    const iv = generateIV();
    const plaintext = new TextEncoder().encode("secret payload");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA, plaintext);

    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyB, encrypted)
    ).rejects.toThrow();
  });

  it("treats empty-string passwords as valid input (no silent special-casing)", async () => {
    const salt = generateSalt();
    const key = await deriveKeyFromPassword("", salt);

    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("is sensitive to every character of the password (no truncation/normalization bug)", async () => {
    const salt = generateSalt();

    const keyA = await deriveKeyFromPassword("password123", salt);
    const keyB = await deriveKeyFromPassword("password124", salt);

    const iv = generateIV();
    const plaintext = new TextEncoder().encode("payload");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA, plaintext);

    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyB, encrypted)
    ).rejects.toThrow();
  });
});
