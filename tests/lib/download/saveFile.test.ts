import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDecryptedFile } from "@/lib/download/saveFile";
import { FileGoneError } from "@/lib/download/errors";
import { generateKey, iterateEncryptedChunks } from "@/lib/crypto";
import type { DecryptedFile } from "@/lib/download/decrypt";

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

async function packEncrypted(content: Uint8Array, key: CryptoKey) {
  const file = new File([content as BlobPart], "x.bin");
  const packedChunks: Uint8Array[] = [];
  for await (const chunk of iterateEncryptedChunks(file, key)) {
    packedChunks.push(chunk);
  }
  return concatBytes(packedChunks);
}

function bodyStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function stubFetchReturning(bytes: Uint8Array, status = 200) {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(bodyStream(bytes), { status })
      : new Response(null, { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FakeWritable = {
  written: Uint8Array[];
  closed: boolean;
  aborted: unknown;
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};

function fakeWritable(): FakeWritable {
  const w: FakeWritable = {
    written: [],
    closed: false,
    aborted: undefined,
    write: async (data) => {
      // 呼び出し側が同じ参照を再利用しても取り違えないようコピーして保持する。
      w.written.push(new Uint8Array(data));
    },
    close: async () => {
      w.closed = true;
    },
    abort: async (reason) => {
      w.aborted = reason ?? null;
    },
  };
  return w;
}

const testFile: DecryptedFile = {
  id: "file-1",
  name: "video.mp4",
  size: 0,
  isOneTime: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveDecryptedFile with showSaveFilePicker", () => {
  it("writes the decrypted bytes to the chosen file handle and closes it (never buffered into a Blob)", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("streamed straight to disk");
    const packed = await packEncrypted(content, key);
    const fetchMock = stubFetchReturning(packed);

    const writable = fakeWritable();
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => writable,
    }));
    vi.stubGlobal("window", { showSaveFilePicker });
    // Blob フォールバックへ絶対に落ちないことを保証する。
    vi.stubGlobal(
      "Blob",
      class {
        constructor() {
          throw new Error("Blob fallback must not be used with showSaveFilePicker");
        }
      }
    );

    const result = await saveDecryptedFile(
      { ...testFile, size: content.byteLength },
      key,
      "video.mp4"
    );

    expect(result).toEqual({ saved: true });
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "video.mp4",
    });
    // ピッカーで保存先を確定してからファイル本体を取りに行く。
    expect(showSaveFilePicker.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]
    );
    expect(writable.closed).toBe(true);
    expect(writable.aborted).toBeUndefined();
    expect(writable.written.length).toBeGreaterThanOrEqual(1);
    expect(concatBytes(writable.written)).toEqual(content);
  });

  it("returns { saved: false } and does not fetch when the user cancels the picker", async () => {
    const key = await generateKey();
    const fetchMock = stubFetchReturning(new Uint8Array(0));

    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    vi.stubGlobal("window", { showSaveFilePicker });

    const result = await saveDecryptedFile(testFile, key, "video.mp4");

    expect(result).toEqual({ saved: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the writable and rethrows when a packet fails to decrypt mid-download", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("abcdefghij".repeat(50));
    const packed = await packEncrypted(content, key);
    // 末尾4バイト(GCMタグの一部)を削り、書き込み途中で復号失敗させる。
    stubFetchReturning(packed.subarray(0, packed.byteLength - 4));

    const writable = fakeWritable();
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => ({
        createWritable: async () => writable,
      })),
    });

    await expect(
      saveDecryptedFile(
        { ...testFile, size: content.byteLength },
        key,
        "video.mp4"
      )
    ).rejects.toThrow();

    expect(writable.closed).toBe(false);
    expect(writable.aborted).not.toBeUndefined();
  });

  it("propagates FileGoneError (404) without creating a file on disk", async () => {
    const key = await generateKey();
    stubFetchReturning(new Uint8Array(0), 404);

    const createWritable = vi.fn(async () => fakeWritable());
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => ({ createWritable })),
    });

    await expect(
      saveDecryptedFile(testFile, key, "video.mp4")
    ).rejects.toThrow(FileGoneError);

    // ストリーム取得より後にハンドルへ書き込むため、404では空ファイルを作らない。
    expect(createWritable).not.toHaveBeenCalled();
  });

  it("falls back to a Blob download when the picker throws a non-abort error", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("blocked picker fallback");
    const packed = await packEncrypted(content, key);
    stubFetchReturning(packed);

    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => {
        // 例: iframe の権限ポリシーでピッカー自体が使えない。
        throw new DOMException("Not allowed", "SecurityError");
      }),
    });

    const blobParts: Uint8Array[][] = [];
    class FakeBlob {
      constructor(parts: Uint8Array[]) {
        blobParts.push(parts);
      }
    }
    vi.stubGlobal("Blob", FakeBlob);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fallback"),
      revokeObjectURL: vi.fn(),
    });
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });

    const result = await saveDecryptedFile(
      { ...testFile, size: content.byteLength },
      key,
      "video.mp4"
    );

    expect(result).toEqual({ saved: true });
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(concatBytes(blobParts[0])).toEqual(content);
  });
});

describe("saveDecryptedFile without showSaveFilePicker (Blob fallback)", () => {
  it("builds a Blob from the decrypted chunks and triggers an <a download> click", async () => {
    const key = await generateKey();
    const content = new TextEncoder().encode("fallback blob content ".repeat(30));
    const packed = await packEncrypted(content, key);
    stubFetchReturning(packed);

    const blobParts: Uint8Array[][] = [];
    class FakeBlob {
      constructor(parts: Uint8Array[]) {
        blobParts.push(parts);
      }
    }
    vi.stubGlobal("Blob", FakeBlob);

    const createObjectURL = vi.fn(() => "blob:fake-url");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    const anchor = { href: "", download: "", click: vi.fn() };
    const createElement = vi.fn(() => anchor);
    vi.stubGlobal("document", { createElement });

    vi.stubGlobal("window", {});

    const result = await saveDecryptedFile(
      { ...testFile, size: content.byteLength },
      key,
      "video.mp4"
    );

    expect(result).toEqual({ saved: true });
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.download).toBe("video.mp4");
    expect(anchor.href).toBe("blob:fake-url");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(blobParts).toHaveLength(1);
    expect(concatBytes(blobParts[0])).toEqual(content);
  });
});
