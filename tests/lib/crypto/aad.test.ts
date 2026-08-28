import { describe, expect, it } from "vitest";
import { buildChunkAad } from "@/lib/crypto/aad";
import { FILE_SALT_LENGTH } from "@/lib/crypto/types";

function salt(byte: number): Uint8Array {
  return new Uint8Array(FILE_SALT_LENGTH).fill(byte);
}

describe("buildChunkAad", () => {
  it("is deterministic for the same input", () => {
    const a = buildChunkAad({ fileSalt: salt(1), index: 3, isLast: false });
    const b = buildChunkAad({ fileSalt: salt(1), index: 3, isLast: false });

    expect(a).toEqual(b);
  });

  it("differs when the index differs", () => {
    const a = buildChunkAad({ fileSalt: salt(1), index: 0, isLast: false });
    const b = buildChunkAad({ fileSalt: salt(1), index: 1, isLast: false });

    expect(a).not.toEqual(b);
  });

  it("differs when isLast differs", () => {
    const a = buildChunkAad({ fileSalt: salt(1), index: 0, isLast: false });
    const b = buildChunkAad({ fileSalt: salt(1), index: 0, isLast: true });

    expect(a).not.toEqual(b);
  });

  it("differs when the file salt differs", () => {
    const a = buildChunkAad({ fileSalt: salt(1), index: 0, isLast: false });
    const b = buildChunkAad({ fileSalt: salt(2), index: 0, isLast: false });

    expect(a).not.toEqual(b);
  });

  it("rejects a file salt of the wrong length", () => {
    expect(() =>
      buildChunkAad({
        fileSalt: new Uint8Array(FILE_SALT_LENGTH - 1),
        index: 0,
        isLast: false,
      })
    ).toThrow();
  });
});
