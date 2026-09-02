import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptFileName,
  decryptFileList,
  unwrapKeyWithPassword,
  fetchAndDecrypt,
  fetchDecryptedStream,
  type RawFile,
} from "@/lib/download/decrypt";
import { FileGoneError, FriendlyError, FILE_GONE_ERROR } from "@/lib/download/errors";
import {
  generateKey,
  exportKey,
  encryptChunk,
  packChunk,
  encodeBase64Url,
  iterateEncryptedChunks,
} from "@/lib/crypto";
import { wrapKeyWithPassword } from "@/lib/upload/encrypt";

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

describe("decryptFileName", () => {
  it("decrypts a name encrypted the same way the upload side does", async () => {
    const key = await generateKey();
    const nameBytes = new TextEncoder().encode("報告書.pdf");
    const encrypted = await encryptChunk(nameBytes, key);
    const encoded = encodeBase64Url(packChunk(encrypted));

    const result = await decryptFileName(encoded, key);

    expect(result).toBe("報告書.pdf");
  });

  it("rejects when decrypted with the wrong key", async () => {
    const key = await generateKey();
    const wrongKey = await generateKey();
    const nameBytes = new TextEncoder().encode("secret.txt");
    const encrypted = await encryptChunk(nameBytes, key);
    const encoded = encodeBase64Url(packChunk(encrypted));

    await expect(decryptFileName(encoded, wrongKey)).rejects.toThrow();
  });
});

describe("decryptFileList", () => {
  it("decrypts each name while preserving id/size/isOneTime and order", async () => {
    const key = await generateKey();
    const rawFiles: RawFile[] = await Promise.all(
      ["a.txt", "b.txt"].map(async (name, i) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(name),
          key
        );

        return {
          id: `id-${i}`,
          name: encodeBase64Url(packChunk(encrypted)),
          size: 100 + i,
          isOneTime: i === 0,
        };
      })
    );

    const result = await decryptFileList(rawFiles, key);

    expect(result).toEqual([
      { id: "id-0", name: "a.txt", size: 100, isOneTime: true },
      { id: "id-1", name: "b.txt", size: 101, isOneTime: false },
    ]);
  });
});

describe("unwrapKeyWithPassword", () => {
  it("round-trips a key wrapped by wrapKeyWithPassword using the same password", async () => {
    const key = await generateKey();
    const { wrappedKey, keySalt } = await wrapKeyWithPassword(
      key,
      "pw-123456"
    );

    const unwrapped = await unwrapKeyWithPassword(
      wrappedKey,
      keySalt,
      "pw-123456"
    );

    expect(new Uint8Array(await exportKey(unwrapped))).toEqual(
      new Uint8Array(await exportKey(key))
    );
  });

  it("rejects when unwrapped with the wrong password", async () => {
    const key = await generateKey();
    const { wrappedKey, keySalt } = await wrapKeyWithPassword(
      key,
      "correct-password"
    );

    await expect(
      unwrapKeyWithPassword(wrappedKey, keySalt, "wrong-password")
    ).rejects.toThrow();
  });
});

async function packEncrypted(file: File, key: CryptoKey): Promise<Uint8Array> {
  const packedChunks: Uint8Array[] = [];
  for await (const chunk of iterateEncryptedChunks(file, key)) {
    packedChunks.push(chunk);
  }
  return concatBytes(packedChunks);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function drainStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concatBytes(parts);
}

describe("fetchDecryptedStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams the decrypted plaintext in order", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode(
      "some streamed content that is decrypted progressively"
    );
    const packed = await packEncrypted(new File([content], "s.bin"), key);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf(packed), { status: 200 }))
    );

    const stream = await fetchDecryptedStream(
      { id: "f1", name: "s.bin", size: content.byteLength, isOneTime: false },
      key
    );

    expect(await drainStream(stream)).toEqual(content);
  });

  it("errors the stream when the final packet is corrupted (GCM auth fails)", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("abcdefghij".repeat(10));
    const packed = await packEncrypted(new File([content], "t.bin"), key);

    // 末尾4バイト(GCMタグの一部)を削ると認証タグが一致しなくなる。
    const corrupted = packed.subarray(0, packed.byteLength - 4);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf(corrupted), { status: 200 }))
    );

    const stream = await fetchDecryptedStream(
      { id: "f2", name: "t.bin", size: content.byteLength, isOneTime: false },
      key
    );

    await expect(drainStream(stream)).rejects.toThrow();
  });

  it("errors the stream when fewer bytes arrive than the file's declared size (silent truncation)", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("complete payload, served in full");
    const packed = await packEncrypted(new File([content], "u.bin"), key);

    // 本体は完全だが、DBが伝える平文サイズ(file.size)より小さい。
    // 末尾パケットが丸ごと欠落した無音の切り詰めと同じ状況で、
    // fetchDecryptedStream が file.size を expectedTotalBytes として
    // 渡していれば検出できる。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf(packed), { status: 200 }))
    );

    const stream = await fetchDecryptedStream(
      {
        id: "f3",
        name: "u.bin",
        size: content.byteLength + 100,
        isOneTime: false,
      },
      key
    );

    await expect(drainStream(stream)).rejects.toThrow(/途中で切断/);
  });

  it("uses a single non-range request for a one-time file", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("one-time payload");
    const packed = await packEncrypted(new File([content], "o.bin"), key);

    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(streamOf(packed), { status: 200, ...init })
    );
    vi.stubGlobal("fetch", fetchMock);

    const stream = await fetchDecryptedStream(
      { id: "one", name: "o.bin", size: content.byteLength, isOneTime: true },
      key
    );

    expect(await drainStream(stream)).toEqual(content);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Range ヘッダを付けずに取得する(サーバーのダウンロード数カウントを1回に保つ)。
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.Range).toBeUndefined();
  });

  it("decrypts correctly when the server answers the range request with a 206 slice", async () => {
    // 大容量の暗号処理は jsdom の crypto.subtle が遅すぎて現実的でないため、
    // ここでは「206 応答からでも復号が成立する」ことだけを小さいデータで確認する。
    // ウィンドウ境界をまたぐ並列再構成のバイト一致は parallelFetch.test.ts が担保する。
    const key = await generateKey();
    const content = new TextEncoder().encode(
      "served as a partial-content response"
    );
    const packed = await packEncrypted(new File([content], "p.bin"), key);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? "")!;
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), packed.byteLength - 1);
      return new Response(packed.slice(start, end + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${packed.byteLength}`,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stream = await fetchDecryptedStream(
      { id: "p", name: "p.bin", size: content.byteLength, isOneTime: false },
      key
    );

    expect(await drainStream(stream)).toEqual(content);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(
      (init?.headers as Record<string, string> | undefined)?.Range
    ).toMatch(/^bytes=0-/);
  });

  it("throws a FileGoneError before returning a stream on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const key = await generateKey();

    await expect(
      fetchDecryptedStream(
        { id: "gone", name: "x", size: 0, isOneTime: false },
        key
      )
    ).rejects.toThrow(FileGoneError);
  });
});

describe("fetchAndDecrypt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads and decrypts a file's full content", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode(
      "hello world, this is a small test file."
    );
    const file = new File([content], "test.bin");

    const packedChunks: Uint8Array[] = [];
    for await (const chunk of iterateEncryptedChunks(file, key)) {
      packedChunks.push(chunk);
    }
    const combinedPacked = concatBytes(packedChunks);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(combinedPacked);
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("/api/file/file-1");
        return new Response(body, { status: 200 });
      })
    );

    const result = await fetchAndDecrypt(
      { id: "file-1", name: "test.bin", size: content.byteLength, isOneTime: false },
      key
    );

    expect(new TextDecoder().decode(result)).toBe(
      "hello world, this is a small test file."
    );
  });

  it("throws a FileGoneError with the standard message on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const key = await generateKey();

    await expect(
      fetchAndDecrypt(
        { id: "gone", name: "x", size: 0, isOneTime: false },
        key
      )
    ).rejects.toThrow(FileGoneError);

    await expect(
      fetchAndDecrypt(
        { id: "gone", name: "x", size: 0, isOneTime: false },
        key
      )
    ).rejects.toThrow(FILE_GONE_ERROR);
  });

  it("throws a generic FriendlyError on other non-ok statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const key = await generateKey();

    await expect(
      fetchAndDecrypt({ id: "x", name: "x", size: 0, isOneTime: false }, key)
    ).rejects.toThrow(FriendlyError);
  });

  it("throws a generic FriendlyError when the response has no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );
    const key = await generateKey();

    await expect(
      fetchAndDecrypt({ id: "x", name: "x", size: 0, isOneTime: false }, key)
    ).rejects.toThrow("ダウンロードに失敗しました。");
  });
});
