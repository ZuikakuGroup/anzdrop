import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import {
  ZIP_NO_ZIP64_LIMIT,
  canStreamFilesAsZip,
  streamFilesAsZip,
  withDuplicateSuffix,
  zipFiles,
} from "@/lib/download/zipDownload";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function collectingSink() {
  const parts: Uint8Array[] = [];
  const sink = {
    closed: false,
    aborted: undefined as unknown,
    write: vi.fn(async (chunk: Uint8Array) => {
      parts.push(chunk.slice());
    }),
    close: vi.fn(async () => {
      sink.closed = true;
    }),
    abort: vi.fn(async (reason?: unknown) => {
      sink.aborted = reason ?? true;
    }),
    bytes: () => {
      const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        out.set(p, offset);
        offset += p.byteLength;
      }
      return out;
    },
  };
  return sink;
}

describe("withDuplicateSuffix", () => {
  it("returns the name unchanged when count is 0", () => {
    expect(withDuplicateSuffix("report.pdf", 0)).toBe("report.pdf");
  });

  it("inserts the count before the extension", () => {
    expect(withDuplicateSuffix("report.pdf", 1)).toBe("report (1).pdf");
    expect(withDuplicateSuffix("report.pdf", 2)).toBe("report (2).pdf");
  });

  it("appends the count at the end when there is no extension", () => {
    expect(withDuplicateSuffix("README", 1)).toBe("README (1)");
  });

  it("treats a leading-dot hidden file as having no extension", () => {
    expect(withDuplicateSuffix(".gitignore", 1)).toBe(".gitignore (1)");
  });
});

describe("zipFiles", () => {
  it("resolves to a zip archive containing every entry with its exact content", async () => {
    const input = {
      "a.txt": new TextEncoder().encode("hello"),
      "b.txt": new TextEncoder().encode("world"),
    };

    const zipped = await zipFiles(input);
    const unzipped = unzipSync(zipped);

    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("hello");
    expect(new TextDecoder().decode(unzipped["b.txt"])).toBe("world");
  });

  it("resolves to an empty archive for empty input", async () => {
    const zipped = await zipFiles({});
    const unzipped = unzipSync(zipped);

    expect(Object.keys(unzipped)).toEqual([]);
  });
});

describe("canStreamFilesAsZip", () => {
  it("許容範囲のサイズなら true", () => {
    expect(canStreamFilesAsZip([100, 1_000_000, 5_000_000])).toBe(true);
    expect(canStreamFilesAsZip([])).toBe(true);
  });

  it("1ファイルでも 4GiB 近い場合は false(zip64 が必要)", () => {
    expect(canStreamFilesAsZip([ZIP_NO_ZIP64_LIMIT])).toBe(false);
    expect(canStreamFilesAsZip([ZIP_NO_ZIP64_LIMIT - 10])).toBe(false);
  });

  it("合計が 4GiB を超える場合は false", () => {
    expect(canStreamFilesAsZip([3_000_000_000, 2_000_000_000])).toBe(false);
  });

  it("エントリごとのオーバーヘッドも見込む(境界)", () => {
    // 合計ちょうど 4GiB - 1 は、エントリオーバーヘッド分でアウト。
    expect(canStreamFilesAsZip([ZIP_NO_ZIP64_LIMIT - 100])).toBe(false);
  });
});

describe("streamFilesAsZip", () => {
  it("各エントリを順に流して、正しく展開できる ZIP を sink へ書き出す", async () => {
    const sink = collectingSink();

    await streamFilesAsZip(
      [
        {
          name: "a.txt",
          open: async () => streamOf(new TextEncoder().encode("hello ")),
        },
        {
          name: "b.txt",
          open: async () =>
            streamOf(
              new TextEncoder().encode("multi"),
              new TextEncoder().encode("-chunk")
            ),
        },
      ],
      sink
    );

    expect(sink.closed).toBe(true);
    expect(sink.aborted).toBeUndefined();

    const unzipped = unzipSync(sink.bytes());
    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("hello ");
    expect(new TextDecoder().decode(unzipped["b.txt"])).toBe("multi-chunk");
  });

  it("エントリのストリームは1つずつ順に open される(全ファイル同時 fetch しない)", async () => {
    const openOrder: string[] = [];
    let concurrentOpen = 0;
    let maxConcurrent = 0;

    const makeEntry = (name: string) => ({
      name,
      open: async () => {
        openOrder.push(name);
        concurrentOpen++;
        maxConcurrent = Math.max(maxConcurrent, concurrentOpen);
        await new Promise((r) => setTimeout(r, 1));
        concurrentOpen--;
        return streamOf(new TextEncoder().encode(name));
      },
    });

    await streamFilesAsZip(
      [makeEntry("1"), makeEntry("2"), makeEntry("3")],
      collectingSink()
    );

    expect(openOrder).toEqual(["1", "2", "3"]);
    expect(maxConcurrent).toBe(1);
  });

  it("エントリの open が失敗したら sink を abort して例外を投げ直す", async () => {
    const sink = collectingSink();
    const boom = new Error("gone");

    await expect(
      streamFilesAsZip(
        [
          {
            name: "ok.txt",
            open: async () => streamOf(new TextEncoder().encode("x")),
          },
          { name: "bad.txt", open: async () => Promise.reject(boom) },
        ],
        sink
      )
    ).rejects.toBe(boom);

    expect(sink.aborted).toBe(boom);
    expect(sink.closed).toBe(false);
  });

  it("sink への書き込みが失敗したら例外を投げ直す", async () => {
    const sink = collectingSink();
    sink.write.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      streamFilesAsZip(
        [
          {
            name: "a.txt",
            open: async () =>
              streamOf(new TextEncoder().encode("some content here")),
          },
        ],
        sink
      )
    ).rejects.toThrow("disk full");

    expect(sink.closed).toBe(false);
  });

  it("読み取りが正常完了する前に失敗したら reader を cancel してから解放する", async () => {
    const sink = collectingSink();
    const boom = new Error("disk full");
    sink.write.mockRejectedValueOnce(boom);

    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const read = vi.fn(async () => ({
      value: new TextEncoder().encode("chunk"),
      done: false as const,
    }));
    const stream = {
      getReader: () => ({ read, cancel, releaseLock }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(
      streamFilesAsZip(
        [{ name: "a.txt", open: async () => stream }],
        sink
      )
    ).rejects.toBe(boom);

    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      releaseLock.mock.invocationCallOrder[0]
    );
  });
});
