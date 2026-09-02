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

  it("フォルダ保存では相対パスを除き、変換後の重複名にも連番を付ける", async () => {
    const savedNames = new Set<string>();
    const getFileHandle = vi.fn(async (name: string) => {
      if (savedNames.has(name)) {
        throw new Error(`duplicate filename: ${name}`);
      }
      savedNames.add(name);
      return {
        createWritable: async () => ({
          write: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
          abort: vi.fn(async () => {}),
        }),
      };
    });
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(),
      showDirectoryPicker: vi.fn(async () => ({ getFileHandle })),
    });
    fetchDecryptedStream.mockImplementation(async () => streamOf("x"));

    const result = await downloadAllFiles(
      [
        file("a", "folder/report.txt", 2_000_000_000),
        file("b", "other\\report.txt", 2_000_000_000),
        file("c", "report (1).txt", 2_000_000_000),
        file("d", "third/REPORT.txt", 2_000_000_000),
      ],
      KEY
    );

    expect([...savedNames]).toEqual([
      "report.txt",
      "report (1).txt",
      "report (1) (1).txt",
      "REPORT (2).txt",
    ]);
    expect(result.started).toBe(true);
  });

  it("showSaveFilePicker が無く Service Worker が使えるなら、SW 経由でストリーミング ZIP を落とす", async () => {
    // 転送可能ストリーム対応チェックと SW コントローラを模す。
    class FakePort {
      onmessage: ((e: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    }
    class FakeMessageChannel {
      port1 = new FakePort();
      port2 = new FakePort();
    }
    vi.stubGlobal("MessageChannel", FakeMessageChannel);

    const posted: { message: Record<string, unknown> }[] = [];
    let latestPort1: FakePort | null = null;
    const receivedZip: Uint8Array[] = [];
    const controller = {
      postMessage: (message: Record<string, unknown>) => {
        if (message.type === "ANZDROP_PING") {
          queueMicrotask(() =>
            latestPort1?.onmessage?.({
              data: { pong: true },
            } as MessageEvent)
          );
          return;
        }
        posted.push({ message });
        // SW / ブラウザが転送された readable を消費するのを模す。
        void (message.readable as ReadableStream<Uint8Array>)
          .pipeTo(
            new WritableStream({
              write(chunk) {
                receivedZip.push(chunk.slice());
              },
            })
          )
          .catch(() => {});
        // 直近に作られた MessageChannel の port1 へ返信する。
        queueMicrotask(() => {
          latestPort1?.onmessage?.({
            data: { url: "/_anzdrop_download/z" },
          } as MessageEvent);
        });
      },
    };
    // saveViaServiceWorker は new MessageChannel() を1回作る。その port1 を捕まえる。
    const OrigChannel = FakeMessageChannel;
    vi.stubGlobal(
      "MessageChannel",
      class extends OrigChannel {
        constructor() {
          super();
          latestPort1 = this.port1;
        }
      }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "abcd-abcd" });

    const iframes: { src: string }[] = [];
    vi.stubGlobal("document", {
      createElement: () => ({ src: "", hidden: false, remove: vi.fn() }),
      body: { appendChild: (el: { src: string }) => iframes.push(el) },
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({})),
        ready: Promise.resolve({}),
        controller,
      },
    });

    fetchDecryptedStream.mockImplementation(async (f: DecryptedFile) =>
      streamOf(`sw-${f.id}`)
    );

    const result = await downloadAllFiles(
      [file("a", "a.txt", 10), file("b", "b.txt", 10)],
      KEY
    );

    expect(result.started).toBe(true);
    expect(fetchAndDecrypt).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0].message.type).toBe("ANZDROP_STREAM_DOWNLOAD");
    expect(posted[0].message.filename).toBe("anzdrop.zip");
    expect(iframes[0].src).toBe("/_anzdrop_download/z");

    // SW へ流れたバイト列が展開可能な ZIP になっている。
    const total = receivedZip.reduce((n, c) => n + c.byteLength, 0);
    const zipBytes = new Uint8Array(total);
    let off = 0;
    for (const c of receivedZip) {
      zipBytes.set(c, off);
      off += c.byteLength;
    }
    const unzipped = unzipSync(zipBytes);
    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("sw-a");
    expect(new TextDecoder().decode(unzipped["b.txt"])).toBe("sw-b");
  });

  it("SW 経由の受け渡しに失敗したら、メモリ内 ZIP へ落とさずリトライを促すエラーを投げる", async () => {
    // ping には応答するが、STREAM_DOWNLOAD には URL を返さない controller。
    class FakePort {
      onmessage: ((e: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    }
    let latestPort1: FakePort | null = null;
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = new FakePort();
        port2 = new FakePort();
        constructor() {
          latestPort1 = this.port1;
        }
      }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "abcd-abcd" });

    const controller = {
      postMessage: (message: Record<string, unknown>) => {
        if (message.type === "ANZDROP_PING") {
          queueMicrotask(() =>
            latestPort1?.onmessage?.({ data: { pong: true } } as MessageEvent)
          );
          return;
        }
        // URL を返さない → saveViaServiceWorker が reject する。
        (message.readable as ReadableStream<Uint8Array>).cancel().catch(() => {});
        queueMicrotask(() =>
          latestPort1?.onmessage?.({ data: {} } as MessageEvent)
        );
      },
    };

    vi.stubGlobal("window", {});
    const blob = stubBlobDownload();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({})),
        ready: Promise.resolve({}),
        controller,
      },
    });
    // showSaveFilePicker / showDirectoryPicker は無い。

    fetchDecryptedStream.mockImplementation(async (f: DecryptedFile) =>
      streamOf(`x-${f.id}`)
    );

    await expect(
      downloadAllFiles([file("a", "a.txt", 10), file("b", "b.txt", 10)], KEY)
    ).rejects.toThrow(/開き直/);

    // メモリ内 ZIP の Blob フォールバックは走っていない(再 fetch で1回限り
    // ファイルを失わせないため)。
    expect(blob.blobParts()).toHaveLength(0);
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

  it("ZIP 保存では相対パスを維持する", async () => {
    vi.stubGlobal("window", {});
    const blob = stubBlobDownload();
    fetchAndDecrypt.mockResolvedValue(new TextEncoder().encode("nested"));

    await downloadAllFiles([file("a", "folder/a.txt", 6)], KEY);

    const unzipped = unzipSync(blob.blobParts()[0] as Uint8Array);
    expect(new TextDecoder().decode(unzipped["folder/a.txt"])).toBe("nested");
  });

  it("File System Access API 非対応 かつ 合計が上限超なら、案内メッセージで中断", async () => {
    vi.stubGlobal("window", {});

    await expect(
      downloadAllFiles(
        [file("a", "huge.bin", IN_MEMORY_ZIP_MAX_BYTES + 1)],
        KEY
      )
    ).rejects.toThrow(/1つずつダウンロード/);

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
