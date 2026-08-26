import { describe, expect, it } from "vitest";
import {
  iterateDecryptedChunks,
  iterateEncryptedChunks,
  iterateFileChunks,
} from "@/lib/crypto/stream";
import { encryptChunk } from "@/lib/crypto/encrypt";
import { decryptChunk } from "@/lib/crypto/decrypt";
import { packChunk, unpackChunk } from "@/lib/crypto/packet";
import { generateKey } from "@/lib/crypto/key";
import { CHUNK_SIZE } from "@/lib/crypto/types";

// crypto.getRandomValues() rejects requests over 65536 bytes, and we need
// multi-megabyte buffers here, so fill deterministically instead of randomly.
// (Content doesn't need to be random for these tests -- only non-trivial and
// non-uniform, so that a broken byte-offset would actually change the data.)
function fillPattern(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(length);
  let state = seed >>> 0;

  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    data[i] = state & 0xff;
  }

  return data;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

// Simulates an unreliable network by delivering `data` through a
// ReadableStream in pieces whose sizes cycle through `pieceSizes`,
// deliberately NOT aligned to any packet/chunk boundary.
function toReadableStream(
  data: Uint8Array,
  pieceSizes: number[]
): ReadableStream<Uint8Array> {
  let offset = 0;
  let pieceIndex = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.byteLength) {
        controller.close();
        return;
      }

      const size = pieceSizes[pieceIndex % pieceSizes.length];
      pieceIndex++;

      const end = Math.min(offset + size, data.byteLength);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}

describe("iterateFileChunks", () => {
  it("yields a single chunk equal to the whole file when smaller than CHUNK_SIZE", async () => {
    const content = fillPattern(1000);
    const file = new File([content], "small.bin");

    const chunks: Uint8Array[] = [];
    for await (const chunk of iterateFileChunks(file)) chunks.push(chunk);

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(content);
  });

  it("yields zero chunks for an empty file", async () => {
    const file = new File([], "empty.bin");

    const chunks: Uint8Array[] = [];
    for await (const chunk of iterateFileChunks(file)) chunks.push(chunk);

    expect(chunks.length).toBe(0);
  });

  it("splits a file of exactly CHUNK_SIZE into one full-size chunk (no trailing empty chunk)", async () => {
    const content = fillPattern(CHUNK_SIZE, 2);
    const file = new File([content], "exact.bin");

    const chunks: Uint8Array[] = [];
    for await (const chunk of iterateFileChunks(file)) chunks.push(chunk);

    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(CHUNK_SIZE);
    expect(chunks[0]).toEqual(content);
  });

  it("splits a file spanning multiple chunks at exactly CHUNK_SIZE boundaries", async () => {
    const remainder = 12345;
    const content = fillPattern(CHUNK_SIZE + remainder, 3);
    const file = new File([content], "big.bin");

    const chunks: Uint8Array[] = [];
    for await (const chunk of iterateFileChunks(file)) chunks.push(chunk);

    expect(chunks.length).toBe(2);
    expect(chunks[0].byteLength).toBe(CHUNK_SIZE);
    expect(chunks[1].byteLength).toBe(remainder);
    expect(concatBytes(chunks)).toEqual(content);
  });
});

describe("iterateEncryptedChunks", () => {
  it("produces packets that each independently decrypt back to the matching plaintext chunk", async () => {
    const remainder = 500;
    const content = fillPattern(CHUNK_SIZE + remainder, 4);
    const file = new File([content], "multi.bin");
    const key = await generateKey();

    const packedChunks: Uint8Array[] = [];
    for await (const packed of iterateEncryptedChunks(file, key)) {
      packedChunks.push(packed);
    }

    expect(packedChunks.length).toBe(2);

    const decryptedChunks: Uint8Array[] = [];
    for (const packed of packedChunks) {
      const { iv, ciphertext } = unpackChunk(packed);
      decryptedChunks.push(new Uint8Array(await decryptChunk(ciphertext, iv, key)));
    }

    expect(decryptedChunks[0].byteLength).toBe(CHUNK_SIZE);
    expect(decryptedChunks[1].byteLength).toBe(remainder);
    expect(concatBytes(decryptedChunks)).toEqual(content);
  });

  it("encrypts each chunk with a distinct IV, even within the same file", async () => {
    const content = fillPattern(CHUNK_SIZE + 999, 5);
    const file = new File([content], "multi2.bin");
    const key = await generateKey();

    const ivs: string[] = [];
    for await (const packed of iterateEncryptedChunks(file, key)) {
      const { iv } = unpackChunk(packed);
      ivs.push(Buffer.from(iv).toString("hex"));
    }

    expect(new Set(ivs).size).toBe(ivs.length);
  });
});

describe("iterateDecryptedChunks (streaming download decryption)", () => {
  it("decrypts a single packet delivered as one whole network read", async () => {
    const key = await generateKey();
    const plaintext = fillPattern(37, 6);
    const packed = packChunk(await encryptChunk(plaintext, key));

    const stream = toReadableStream(packed, [packed.byteLength]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);

    expect(out.length).toBe(1);
    expect(out[0]).toEqual(plaintext);
  });

  it("decrypts a single packet delivered strictly one byte at a time (worst-case fragmentation)", async () => {
    const key = await generateKey();
    const plaintext = fillPattern(53, 7);
    const packed = packChunk(await encryptChunk(plaintext, key));

    const stream = toReadableStream(packed, [1]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);

    expect(out.length).toBe(1);
    expect(out[0]).toEqual(plaintext);
  });

  it("reassembles two packets (spanning a CHUNK_SIZE boundary) from an unaligned, irregularly-chunked network stream", async () => {
    const key = await generateKey();
    const remainder = 12345;
    const plaintextChunk1 = fillPattern(CHUNK_SIZE, 8);
    const plaintextChunk2 = fillPattern(remainder, 9);

    const packed1 = packChunk(await encryptChunk(plaintextChunk1, key));
    const packed2 = packChunk(await encryptChunk(plaintextChunk2, key));
    const wireBytes = concatBytes([packed1, packed2]);

    // Deliberately unaligned piece sizes: none of these evenly divide the
    // packet boundary at CHUNK_SIZE+28, so nearly every read straddles it.
    const stream = toReadableStream(wireBytes, [1, 17, 4096, 131071, 3]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);

    expect(out.length).toBe(2);
    expect(out[0].byteLength).toBe(CHUNK_SIZE);
    expect(out[0]).toEqual(plaintextChunk1);
    expect(out[1].byteLength).toBe(remainder);
    expect(out[1]).toEqual(plaintextChunk2);
  });

  it("yields nothing for an empty stream (zero-byte download)", async () => {
    const key = await generateKey();
    const stream = toReadableStream(new Uint8Array(0), [64]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);

    expect(out.length).toBe(0);
  });

  it("succeeds silently when expectedTotalBytes matches the actual decrypted size", async () => {
    const key = await generateKey();
    const plaintext = fillPattern(500, 20);
    const packed = packChunk(await encryptChunk(plaintext, key));
    const stream = toReadableStream(packed, [64]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key, plaintext.byteLength)) {
      out.push(chunk);
    }

    expect(concatBytes(out)).toEqual(plaintext);
  });

  it("rejects when the stream ends with an entire trailing packet missing, if expectedTotalBytes is supplied (silent truncation attack/failure)", async () => {
    const key = await generateKey();
    const remainder = 777;
    const plaintextChunk1 = fillPattern(CHUNK_SIZE, 21);
    const plaintextChunk2 = fillPattern(remainder, 22);

    const packed1 = packChunk(await encryptChunk(plaintextChunk1, key));
    // packed2 is computed but deliberately never sent, simulating a
    // connection cut or a truncated object in storage: the wire only
    // carries the first packet, yet it ends up ending on a clean packet
    // boundary so no unpackChunk/GCM error would ever fire on its own.
    await encryptChunk(plaintextChunk2, key);

    const truncatedWire = packed1; // second packet entirely absent
    const expectedTotalBytes = plaintextChunk1.byteLength + plaintextChunk2.byteLength;

    const stream = toReadableStream(truncatedWire, [4096]);

    const out: Uint8Array[] = [];

    await expect(async () => {
      for await (const chunk of iterateDecryptedChunks(stream, key, expectedTotalBytes)) {
        out.push(chunk);
      }
    }).rejects.toThrow();

    // The first (complete, authentic) packet is still delivered before the
    // truncation is detected -- only the missing second packet is caught.
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(plaintextChunk1);
  });

  it("without expectedTotalBytes, a whole trailing packet going missing is NOT detected (documents why callers must pass the expected size)", async () => {
    const key = await generateKey();
    const plaintextChunk1 = fillPattern(CHUNK_SIZE, 23);
    const packed1 = packChunk(await encryptChunk(plaintextChunk1, key));
    // A second packet is never produced or sent at all.

    const stream = toReadableStream(packed1, [4096]);

    const out: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);

    // No error is raised, and only the first packet's worth of data comes
    // out -- this generator alone cannot know more data was supposed to
    // follow. Callers that care about completeness MUST pass
    // expectedTotalBytes (see the previous test).
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(plaintextChunk1);
  });

  it("rejects (throws) when a packet's ciphertext is corrupted in transit, instead of yielding garbage", async () => {
    const key = await generateKey();
    const plaintext = fillPattern(200, 10);
    const packed = packChunk(await encryptChunk(plaintext, key));

    const tampered = new Uint8Array(packed);
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the auth tag

    const stream = toReadableStream(tampered, [23]);

    const drained: Uint8Array[] = [];

    await expect(async () => {
      for await (const chunk of iterateDecryptedChunks(stream, key)) {
        drained.push(chunk);
      }
    }).rejects.toThrow();
  });

  it("rejects when the SECOND of two packets is corrupted (validates the trailing 'remainder' packet path, not just the fixed-size path)", async () => {
    const key = await generateKey();
    const plaintextChunk1 = fillPattern(CHUNK_SIZE, 11);
    const plaintextChunk2 = fillPattern(999, 12);

    const packed1 = packChunk(await encryptChunk(plaintextChunk1, key));
    const packed2 = packChunk(await encryptChunk(plaintextChunk2, key));
    const packed2Tampered = new Uint8Array(packed2);
    packed2Tampered[0] ^= 0xff; // corrupt IV of the second packet

    const wireBytes = concatBytes([packed1, packed2Tampered]);
    const stream = toReadableStream(wireBytes, [50000]);

    const out: Uint8Array[] = [];

    await expect(async () => {
      for await (const chunk of iterateDecryptedChunks(stream, key)) out.push(chunk);
    }).rejects.toThrow();

    // The first (untampered) packet should still have been yielded correctly
    // before the failure on the second packet.
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(plaintextChunk1);
  });

  it("full pipeline round-trip: iterateFileChunks -> iterateEncryptedChunks -> unaligned network stream -> iterateDecryptedChunks reproduces the original file byte-for-byte", async () => {
    const key = await generateKey();
    const content = fillPattern(CHUNK_SIZE + 54321, 13);
    const file = new File([content], "roundtrip.bin");

    const packedChunks: Uint8Array[] = [];
    for await (const packed of iterateEncryptedChunks(file, key)) {
      packedChunks.push(packed);
    }
    const wireBytes = concatBytes(packedChunks);

    const stream = toReadableStream(wireBytes, [7, 65537, 2, 999, 40000]);

    const decrypted: Uint8Array[] = [];
    for await (const chunk of iterateDecryptedChunks(stream, key, content.byteLength)) {
      decrypted.push(chunk);
    }

    expect(concatBytes(decrypted)).toEqual(content);
  });
});
