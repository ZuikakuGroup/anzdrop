import { describe, expect, it } from "vitest";
import { encryptChunk } from "./encrypt";
import { decryptChunk } from "./decrypt";
import { generateKey } from "./key";
import { GCM_TAG_LENGTH } from "./types";

describe("encryptChunk / decryptChunk round-trip", () => {
  it("recovers the exact original plaintext", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("これはAnzdropのテストです。E2EE!");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const decrypted = await decryptChunk(ciphertext, iv, key);

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it("round-trips binary data covering every byte value", async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(256);
    for (let i = 0; i < 256; i++) plaintext[i] = i;

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const decrypted = await decryptChunk(ciphertext, iv, key);

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it("round-trips empty plaintext", async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(0);

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const decrypted = await decryptChunk(ciphertext, iv, key);

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it("ciphertext is exactly plaintext length + GCM_TAG_LENGTH bytes", async () => {
    const key = await generateKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(1000));

    const { ciphertext } = await encryptChunk(plaintext, key);

    expect(ciphertext.byteLength).toBe(plaintext.byteLength + GCM_TAG_LENGTH);
  });

  it("ciphertext never equals the plaintext, even for all-zero input (no accidental no-op cipher)", async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(64); // all zeros

    const { ciphertext } = await encryptChunk(plaintext, key);
    const cipherBytes = new Uint8Array(ciphertext).slice(0, 64);

    expect(cipherBytes).not.toEqual(plaintext);
  });

  it("uses a fresh random IV on every call, never reusing one (catastrophic for AES-GCM if violated)", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("same message every time");

    const seenIVs = new Set<string>();
    const seenCiphertexts = new Set<string>();
    const iterations = 200;

    for (let i = 0; i < iterations; i++) {
      const { iv, ciphertext } = await encryptChunk(plaintext, key);
      seenIVs.add(Buffer.from(iv).toString("hex"));
      seenCiphertexts.add(Buffer.from(ciphertext).toString("hex"));
    }

    expect(seenIVs.size).toBe(iterations);
    // Different IVs for identical plaintext must yield different ciphertexts.
    expect(seenCiphertexts.size).toBe(iterations);
  });
});

describe("decryptChunk authentication (tamper detection)", () => {
  it("rejects ciphertext that has been bit-flipped after encryption", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("integrity matters");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    await expect(decryptChunk(tampered.buffer, iv, key)).rejects.toThrow();
  });

  it("rejects ciphertext with a flipped bit in the GCM authentication tag (last 16 bytes)", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("tag integrity matters too");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0x01;

    await expect(decryptChunk(tampered.buffer, iv, key)).rejects.toThrow();
  });

  it("rejects truncated ciphertext (missing/partial auth tag)", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("do not truncate me");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const truncated = new Uint8Array(ciphertext).slice(0, ciphertext.byteLength - 4);

    await expect(decryptChunk(truncated.buffer, iv, key)).rejects.toThrow();
  });

  it("rejects decryption with the wrong key", async () => {
    const key = await generateKey();
    const wrongKey = await generateKey();
    const plaintext = new TextEncoder().encode("only the right key may read this");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);

    await expect(decryptChunk(ciphertext, iv, wrongKey)).rejects.toThrow();
  });

  it("rejects decryption with the wrong IV (even with the correct key)", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("iv matters too");

    const { iv, ciphertext } = await encryptChunk(plaintext, key);
    const wrongIv = new Uint8Array(iv);
    wrongIv[0] ^= 0xff;

    await expect(decryptChunk(ciphertext, wrongIv, key)).rejects.toThrow();
  });

  it("rejects ciphertexts swapped between two independently-encrypted messages (no cross-message forgery)", async () => {
    const key = await generateKey();

    const msgA = await encryptChunk(new TextEncoder().encode("message A"), key);
    const msgB = await encryptChunk(new TextEncoder().encode("message B"), key);

    // Using message A's IV with message B's ciphertext must fail authentication.
    await expect(decryptChunk(msgB.ciphertext, msgA.iv, key)).rejects.toThrow();
  });
});
