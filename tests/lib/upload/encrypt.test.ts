import { describe, expect, it } from "vitest";
import { encryptFileName, wrapKeyWithPassword } from "@/lib/upload/encrypt";
import {
  generateKey,
  exportKey,
  decodeBase64Url,
  unpackChunk,
  decryptChunk,
  deriveKeyFromPassword,
  importKey,
} from "@/lib/crypto";

describe("encryptFileName", () => {
  it("produces a base64url string that decrypts back to the original name", async () => {
    const key = await generateKey();

    const encoded = await encryptFileName("報告書.pdf", key);

    const packed = new Uint8Array(decodeBase64Url(encoded));
    const { iv, ciphertext } = unpackChunk(packed);
    const decrypted = await decryptChunk(ciphertext, iv, key);

    expect(new TextDecoder().decode(decrypted)).toBe("報告書.pdf");
  });

  it("uses a fresh random IV each call, so the same name encrypts differently", async () => {
    const key = await generateKey();

    const first = await encryptFileName("same-name.txt", key);
    const second = await encryptFileName("same-name.txt", key);

    expect(first).not.toBe(second);
  });
});

describe("wrapKeyWithPassword", () => {
  it("wraps the key so it can be unwrapped with the same password and used for decryption", async () => {
    const key = await generateKey();
    const password = "correct horse battery staple";

    const { wrappedKey, keySalt } = await wrapKeyWithPassword(key, password);

    const salt = new Uint8Array(decodeBase64Url(keySalt));
    const kek = await deriveKeyFromPassword(password, salt);
    const packed = new Uint8Array(decodeBase64Url(wrappedKey));
    const { iv, ciphertext } = unpackChunk(packed);
    const rawKey = await decryptChunk(ciphertext, iv, kek);
    const unwrappedKey = await importKey(rawKey);

    expect(new Uint8Array(await exportKey(unwrappedKey))).toEqual(
      new Uint8Array(await exportKey(key))
    );
  });

  it("cannot be unwrapped with the wrong password", async () => {
    const key = await generateKey();
    const { wrappedKey, keySalt } = await wrapKeyWithPassword(
      key,
      "correct-password"
    );

    const salt = new Uint8Array(decodeBase64Url(keySalt));
    const wrongKek = await deriveKeyFromPassword("wrong-password", salt);
    const packed = new Uint8Array(decodeBase64Url(wrappedKey));
    const { iv, ciphertext } = unpackChunk(packed);

    await expect(decryptChunk(ciphertext, iv, wrongKek)).rejects.toThrow();
  });

  it("generates a fresh salt each call", async () => {
    const key = await generateKey();

    const first = await wrapKeyWithPassword(key, "password");
    const second = await wrapKeyWithPassword(key, "password");

    expect(first.keySalt).not.toBe(second.keySalt);
  });
});
