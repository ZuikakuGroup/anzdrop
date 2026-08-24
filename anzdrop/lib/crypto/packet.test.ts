import { describe, expect, it } from "vitest";
import { packChunk, unpackChunk } from "./packet";
import { IV_LENGTH, type EncryptionResult } from "./types";

function makeResult(ivByte: number, cipherBytes: number[]): EncryptionResult {
  const iv = new Uint8Array(IV_LENGTH).fill(ivByte);
  const ciphertext = new Uint8Array(cipherBytes).buffer;

  return { iv, ciphertext };
}

describe("packChunk / unpackChunk", () => {
  it("round-trips iv and ciphertext exactly", () => {
    const original = makeResult(7, [1, 2, 3, 4, 5, 250, 251, 252]);

    const packed = packChunk(original);
    const unpacked = unpackChunk(packed);

    expect(new Uint8Array(unpacked.iv)).toEqual(original.iv);
    expect(new Uint8Array(unpacked.ciphertext)).toEqual(
      new Uint8Array(original.ciphertext)
    );
  });

  it("lays out bytes as IV (first IV_LENGTH bytes) followed by ciphertext", () => {
    const iv = new Uint8Array(IV_LENGTH).fill(9);
    const ciphertext = new Uint8Array([11, 22, 33]).buffer;

    const packed = packChunk({ iv, ciphertext });

    expect(packed.byteLength).toBe(IV_LENGTH + 3);
    expect(Array.from(packed.slice(0, IV_LENGTH))).toEqual(
      Array.from(iv)
    );
    expect(Array.from(packed.slice(IV_LENGTH))).toEqual([11, 22, 33]);
  });

  it("round-trips an empty ciphertext (packet is exactly IV_LENGTH bytes)", () => {
    const original = makeResult(1, []);

    const packed = packChunk(original);
    expect(packed.byteLength).toBe(IV_LENGTH);

    const unpacked = unpackChunk(packed);
    expect(new Uint8Array(unpacked.ciphertext).byteLength).toBe(0);
    expect(new Uint8Array(unpacked.iv)).toEqual(original.iv);
  });

  it("throws on a packet shorter than IV_LENGTH (corrupted/truncated data)", () => {
    const tooShort = new Uint8Array(IV_LENGTH - 1);

    expect(() => unpackChunk(tooShort)).toThrow();
  });

  it("does not throw for a packet of exactly IV_LENGTH bytes (zero-length ciphertext is valid)", () => {
    const exact = new Uint8Array(IV_LENGTH);

    expect(() => unpackChunk(exact)).not.toThrow();
  });

  it("unpackChunk produces an independent ciphertext buffer unaffected by mutating the source array afterwards", () => {
    const iv = new Uint8Array(IV_LENGTH).fill(3);
    const ciphertext = new Uint8Array([100, 101, 102]).buffer;
    const packed = packChunk({ iv, ciphertext });

    const unpacked = unpackChunk(packed);
    const before = Array.from(new Uint8Array(unpacked.ciphertext));

    // Mutate the packed source after unpacking.
    packed.fill(0);

    const after = Array.from(new Uint8Array(unpacked.ciphertext));
    expect(after).toEqual(before);
  });

  it("correctly unpacks a chunk carved out of a larger underlying buffer (non-zero byteOffset)", () => {
    // Simulates the real-world case where `data` passed to unpackChunk is a
    // subarray view into a larger network-received buffer.
    const iv = new Uint8Array(IV_LENGTH).fill(5);
    const cipherBytes = [9, 8, 7, 6];
    const original = { iv, ciphertext: new Uint8Array(cipherBytes).buffer };
    const packed = packChunk(original);

    const bigBuffer = new Uint8Array(10 + packed.byteLength);
    bigBuffer.set(packed, 10);
    const view = bigBuffer.subarray(10, 10 + packed.byteLength);

    const unpacked = unpackChunk(view);

    expect(new Uint8Array(unpacked.iv)).toEqual(iv);
    expect(Array.from(new Uint8Array(unpacked.ciphertext))).toEqual(cipherBytes);
  });
});
