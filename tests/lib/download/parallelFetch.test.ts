import { describe, it, expect, vi } from "vitest";
import { createParallelCiphertextStream } from "@/lib/download/parallelFetch";
import { FileGoneError, FriendlyError } from "@/lib/download/errors";

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concat(parts);
}

function rangeOf(init: RequestInit | undefined): string | null {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Range ?? null;
}

// data 全体を保持し、Range リクエストごとに 206 + Content-Range で切り出して返す
// 疑似サーバー。behavior で個々のウィンドウ応答を細工できる。
function makeServer(
  data: Uint8Array<ArrayBuffer>,
  behavior: {
    ignoreRange?: boolean;
    // 「この開始オフセットのリクエストは、指定回数だけ status を返してから成功させる」
    transientFailures?: Map<number, { status: number; times: number }>;
    permanentFailureAt?: number;
    // この開始オフセットのリクエストには、206 ではなく 200 + 全体本体を返す。
    fullBodyAt?: number;
    // ウィンドウ完了順を入れ替えるための、開始オフセット別の遅延(ms)。
    delayByStart?: Map<number, number>;
  } = {}
): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const range = rangeOf(init);

    if (!range || behavior.ignoreRange) {
      return new Response(data, { status: 200 });
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), data.byteLength - 1);

    const delay = behavior.delayByStart?.get(start);
    if (delay) {
      await new Promise((r) => setTimeout(r, delay));
    }

    if (behavior.permanentFailureAt === start) {
      return new Response("boom", { status: 500 });
    }

    const transient = behavior.transientFailures?.get(start);
    if (transient && transient.times > 0) {
      transient.times -= 1;
      return new Response("temporary", { status: transient.status });
    }

    if (behavior.fullBodyAt === start) {
      return new Response(data, { status: 200 });
    }

    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${data.byteLength}`,
      },
    });
  });
}

const instantSleep = (): Promise<void> => Promise.resolve();

describe("createParallelCiphertextStream", () => {
  it("reassembles the exact bytes in order across many parallel windows", async () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 7) % 253);
    const fetchImpl = makeServer(data);

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await drain(stream)).toEqual(data);
    // 先頭ウィンドウ(プローブ)含めて 10 ウィンドウ。
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("keeps output order even when later windows finish first", async () => {
    const data = new Uint8Array(500).map((_, i) => i % 251);
    const fetchImpl = makeServer(data, {
      // window 1 (start 100) は遅く、window 2/3/4 が先に返る。
      delayByStart: new Map([
        [100, 40],
        [200, 5],
        [300, 5],
        [400, 5],
      ]),
    });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await drain(stream)).toEqual(data);
  });

  it("falls back to the single response body when the server ignores Range (200)", async () => {
    const data = new Uint8Array(400).fill(9);
    const fetchImpl = makeServer(data, { ignoreRange: true });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await drain(stream)).toEqual(data);
    // 200 を受けた時点で追加リクエストは出さない。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns everything from the first window when the file fits in one window", async () => {
    const data = new Uint8Array(60).map((_, i) => i);
    const fetchImpl = makeServer(data);

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await drain(stream)).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient per-window failure and still completes", async () => {
    const data = new Uint8Array(300).map((_, i) => i % 200);
    const fetchImpl = makeServer(data, {
      transientFailures: new Map([[100, { status: 503, times: 2 }]]),
    });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: instantSleep,
    });

    expect(await drain(stream)).toEqual(data);
  });

  it("retries a transient failure on the first (probe) request and still completes", async () => {
    const data = new Uint8Array(300).map((_, i) => i % 200);
    const fetchImpl = makeServer(data, {
      transientFailures: new Map([[0, { status: 503, times: 2 }]]),
    });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: instantSleep,
    });

    expect(await drain(stream)).toEqual(data);
  });

  it("errors the stream (does not corrupt) when a non-first window answers 200 with the full body", async () => {
    const data = new Uint8Array(500).map((_, i) => (i * 3) % 240);
    const fetchImpl = makeServer(data, { fullBodyAt: 100 });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: instantSleep,
    });

    await expect(drain(stream)).rejects.toThrow(FriendlyError);
  });

  it("errors the stream when a window keeps failing", async () => {
    const data = new Uint8Array(300).fill(1);
    const fetchImpl = makeServer(data, { permanentFailureAt: 100 });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: instantSleep,
    });

    await expect(drain(stream)).rejects.toThrow(FriendlyError);
  });

  it("throws FileGoneError on a 404 first response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      createParallelCiphertextStream("/api/file/x", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(FileGoneError);
  });

  it("throws a FriendlyError on a non-404 error first response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));

    await expect(
      createParallelCiphertextStream("/api/file/x", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(FriendlyError);
  });

  it("aborts in-flight window fetches when the stream is cancelled", async () => {
    const data = new Uint8Array(1000).fill(3);
    let aborted = 0;

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = rangeOf(init);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "")!;
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), data.byteLength - 1);

      if (start === 0) {
        return new Response(data.slice(0, end + 1), {
          status: 206,
          headers: { "Content-Range": `bytes 0-${end}/${data.byteLength}` },
        });
      }

      // 先頭以外のウィンドウは、abort されるまで待つ。
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          aborted += 1;
          reject(new DOMException("aborted", "AbortError"));
        });
        setTimeout(() => resolve(new Response(new Uint8Array(0))), 5000);
      });
    });

    const stream = await createParallelCiphertextStream("/api/file/x", {
      windowSize: 100,
      concurrency: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reader = stream.getReader();
    await reader.read(); // 先頭ウィンドウを消費

    // pull() が次のウィンドウ待ちに入ったところで cancel する。
    const pendingRead = reader.read();
    await reader.cancel();

    // cancel 後の read はハングせず done で解決する(内部 pull がループを
    // 抜けられずハングする回帰の検出)。
    const settled = await Promise.race([
      pendingRead.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);

    expect(settled).toBe("settled");
    expect(aborted).toBeGreaterThan(0);
  });
});
