import { afterEach, describe, expect, it, vi } from "vitest";
import { FileGoneError } from "@/lib/download/errors";
import type { DecryptedFile } from "@/lib/download/decrypt";

// 復号は本題ではないので、decrypt モジュールをフェイクに差し替える。
const fetchDecryptedStream = vi.fn();
const fetchAndDecrypt = vi.fn();

vi.mock("@/lib/download/decrypt", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, fetchDecryptedStream, fetchAndDecrypt };
});

const { downloadAllFiles, IN_MEMORY_ZIP_MAX_BYTES } = await import(
  "@/lib/download/downloadAll"
);
const { unzipSync } = await import("fflate");

function file(id: string, name: string, size: number): DecryptedFile {
  return { id, name, size, isOneTime: false };
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

// メモリ内 Blob フォールバックが呼ぶ DOM API のフェイク。
function stubBlobDownload(): { downloadedName: () => string; blobParts: () => unknown[] } {
  let name = "";
  let parts: unknown[] = [];
  class FakeBlob {
    constructor(p: unknown[]) {
      parts = p;
    }
  }
  vi.stubGlobal("Blob", FakeBlob);
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      set href(_v: string) {},
      set download(v: string) {
        name = v;
      },
      click: vi.fn(),
    }),
  });
  return { downloadedName: () => name, blobParts: () => parts };
}

const KEY = {} as CryptoKey;

afterEach(() => {
  vi.unstubAllGlobals();
  fetchDecryptedStream.mockReset();
  fetchAndDecrypt.mockReset();
});

describe("downloadAllFiles — 経路の選択", () => {
  it("showSaveFilePicker があり zip64 不要なら、ストリーミング ZIP をディスクへ書く", async () => {
    const writes: Uint8Array[] = [];
    const createWritable = vi.fn(async () => ({
      write: async (c: Uint8Array) => {
        writes.push(c.slice());
      },
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    }));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    vi.stubGlobal("window", { showSaveFilePicker });

    fetchDecryptedStream.mockImplementation(async (f: DecryptedFile) =>
      streamOf(`content-of-${f.id}`)
    );

    const result = await downloadAllFiles(
      [file("a", "a.txt", 10), file("b", "a.txt", 10)],
      KEY
    );

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "anzdrop.zip",
    });
    expect(result.started).toBe(true);
    expect(fetchAndDecrypt).not.toHaveBeenCalled();

    const zipBytes = new Uint8Array(
      writes.reduce((n, w) => n + w.byteLength, 0)
    );
    let off = 0;
    for (const w of writes) {
      zipBytes.set(w, off);
      off += w.byteLength;
    }
    const unzipped = unzipSync(zipBytes);
    // 重複ファイル名は連番付与される。
    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("content-of-a");
    expect(new TextDecoder().decode(unzipped["a (1).txt"])).toBe("content-of-b");
  });

  it("キャンセル(AbortError)なら started=false で返る", async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    vi.stubGlobal("window", { showSaveFilePicker });

    const result = await downloadAllFiles([file("a", "a.txt", 10)], KEY);

    expect(result).toEqual({ cancelled: true, goneFileIds: [], started: false });
  });

  it("4GiB を超える場合は showDirectoryPicker でフォルダへ1ファイルずつ保存", async () => {
    const savedNames: string[] = [];
    const getFileHandle = vi.fn(async (name: string) => {
      savedNames.push(name);
      return {
        createWritable: async () => ({
          write: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
          abort: vi.fn(async () => {}),
        }),
      };
    });
    const showDirectoryPicker = vi.fn(async () => ({ getFileHandle }));
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(),
      showDirectoryPicker,
    });

    fetchDecryptedStream.mockImplementation(async () => streamOf("x"));

    const result = await downloadAllFiles(
      [file("a", "big1.bin", 3_000_000_000), file("b", "big2.bin", 2_000_000_000)],
      KEY
    );

    expect(showDirectoryPicker).toHaveBeenCalled();
    expect(savedNames).toEqual(["big1.bin", "big2.bin"]);
    expect(result.started).toBe(true);
  });

  it("File System Access API 非対応 かつ 合計が上限内なら、メモリ内 ZIP を Blob で落とす", async () => {
    vi.stubGlobal("window", {});
    const blob = stubBlobDownload();

    fetchAndDecrypt.mockImplementation(async (f: DecryptedFile) =>
      new TextEncoder().encode(`mem-${f.id}`)
    );

    const result = await downloadAllFiles(
      [file("a", "a.txt", 5), file("b", "b.txt", 5)],
      KEY
    );

    expect(fetchDecryptedStream).not.toHaveBeenCalled();
    expect(blob.downloadedName()).toBe("anzdrop.zip");
    expect(result.started).toBe(true);

    const unzipped = unzipSync(blob.blobParts()[0] as Uint8Array);
    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("mem-a");
    expect(new TextDecoder().decode(unzipped["b.txt"])).toBe("mem-b");
  });

  it("File System Access API 非対応 かつ 合計が上限超なら、案内メッセージで中断", async () => {
    vi.stubGlobal("window", {});

    await expect(
      downloadAllFiles(
        [file("a", "huge.bin", IN_MEMORY_ZIP_MAX_BYTES + 1)],
        KEY
      )
    ).rejects.toThrow(/Chrome/);

    expect(fetchAndDecrypt).not.toHaveBeenCalled();
  });
});

describe("downloadAllFiles — 404 の扱い", () => {
  it("メモリ内 ZIP 経路: 消えたファイルはスキップし onFileGone で通知、残りで ZIP を作る", async () => {
    vi.stubGlobal("window", {});
    const blob = stubBlobDownload();
    const gone: string[] = [];

    fetchAndDecrypt.mockImplementation(async (f: DecryptedFile) => {
      if (f.id === "b") throw new FileGoneError("gone");
      return new TextEncoder().encode(`mem-${f.id}`);
    });

    const result = await downloadAllFiles(
      [file("a", "a.txt", 5), file("b", "b.txt", 5), file("c", "c.txt", 5)],
      KEY,
      { onFileGone: (id) => gone.push(id) }
    );

    expect(gone).toEqual(["b"]);
    expect(result.goneFileIds).toEqual(["b"]);

    const unzipped = unzipSync(blob.blobParts()[0] as Uint8Array);
    expect(Object.keys(unzipped).sort()).toEqual(["a.txt", "c.txt"]);
  });

  it("メモリ内 ZIP 経路: 全ファイルが消えていたら「削除されています」で中断", async () => {
    vi.stubGlobal("window", {});
    stubBlobDownload();
    const gone: string[] = [];
    fetchAndDecrypt.mockRejectedValue(new FileGoneError("gone"));

    await expect(
      downloadAllFiles([file("a", "a.txt", 5)], KEY, {
        onFileGone: (id) => gone.push(id),
      })
    ).rejects.toThrow(/削除されています/);
    expect(gone).toEqual(["a"]);
  });

  it("ストリーミング ZIP 経路: 途中の 404 は onFileGone 通知後に中断エラーを投げる", async () => {
    const createWritable = vi.fn(async () => ({
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    }));
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => ({ createWritable })),
    });

    const gone: string[] = [];
    fetchDecryptedStream.mockImplementation(async (f: DecryptedFile) => {
      if (f.id === "b") throw new FileGoneError("gone");
      return streamOf("ok");
    });

    await expect(
      downloadAllFiles(
        [file("a", "a.txt", 10), file("b", "b.txt", 10)],
        KEY,
        { onFileGone: (id) => gone.push(id) }
      )
    ).rejects.toThrow(/中止/);

    expect(gone).toEqual(["b"]);
  });
});
