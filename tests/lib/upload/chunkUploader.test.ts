import { afterEach, describe, expect, it, vi } from "vitest";
import {
  repartition,
  uploadChunksFromStream,
} from "@/lib/upload/chunkUploader";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";

async function* fromArray(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function concat(pieces: Uint8Array[]): Uint8Array {
  const total = pieces.reduce((sum, piece) => sum + piece.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.byteLength;
  }
  return out;
}

// 多MB配列に対する expect(...).toEqual(...) は、このVitest/Node環境では
// インデックス列挙でヒープを食い潰すため、バイト比較はこのヘルパーで行う。
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
}

// テストデータのバイト列(内容の一致検証用に位置ごとに異なる値を入れる)。
function ramp(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i + seed) & 0xff;
  }
  return out;
}

async function collect(
  source: AsyncGenerator<{ partNumber: number; body: Uint8Array }>
): Promise<{ partNumber: number; body: Uint8Array }[]> {
  const out: { partNumber: number; body: Uint8Array }[] = [];
  for await (const part of source) {
    out.push(part);
  }
  return out;
}

// リトライのバックオフ待ちを実時間なしで回すためのテスト用オプション。
const noBackoff = {
  backoffMs: () => 0,
  sleep: async () => {},
};

describe("UPLOAD_PART_SIZE", () => {
  it("meets R2's 5MiB minimum size for non-final multipart parts", () => {
    // repartition は最終パート以外を必ず UPLOAD_PART_SIZE ちょうどにする。
    // R2 は非最終パートが 5MiB 未満だと complete() を拒否するため、
    // (CHUNK_SIZE を小さくするなどで)ここを下回ると本番アップロードが壊れる。
    expect(UPLOAD_PART_SIZE).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });
});

describe("repartition", () => {
  it("re-slices into uniform partSize parts with a smaller final part, independent of source boundaries", async () => {
    // 送信元のチャンク境界(3 / 5 / 5 / 5 / 2 バイト = 合計20)を、
    // partSize=6 で 6 / 6 / 6 / 2 の4パートに詰め直す。
    const source = [ramp(3, 1), ramp(5, 2), ramp(5, 3), ramp(5, 4), ramp(2, 5)];
    const parts = await collect(repartition(fromArray(source), 6));

    expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3, 4]);
    expect(parts.map((part) => part.body.byteLength)).toEqual([6, 6, 6, 2]);

    // 連結すると元のストリームにバイト単位で一致する。
    expectBytesEqual(
      concat(parts.map((part) => part.body)),
      concat(source)
    );
  });

  it("emits a single final part when the whole stream is smaller than partSize", async () => {
    const source = [ramp(3), ramp(4, 9)];
    const parts = await collect(repartition(fromArray(source), 100));

    expect(parts).toHaveLength(1);
    expect(parts[0].partNumber).toBe(1);
    expectBytesEqual(parts[0].body, concat(source));
  });

  it("emits exact parts with no trailing part when the stream is a whole multiple of partSize", async () => {
    const source = [ramp(4), ramp(4, 1), ramp(4, 2)];
    const parts = await collect(repartition(fromArray(source), 6));

    expect(parts.map((part) => part.body.byteLength)).toEqual([6, 6]);
    expectBytesEqual(concat(parts.map((part) => part.body)), concat(source));
  });

  it("emits nothing for an empty stream", async () => {
    const parts = await collect(repartition(fromArray([]), 6));
    expect(parts).toEqual([]);
  });

  it("ignores zero-length pieces from the source", async () => {
    const source = [new Uint8Array(0), ramp(6, 1), new Uint8Array(0), ramp(3, 2)];
    const parts = await collect(repartition(fromArray(source), 6));

    expect(parts.map((part) => part.body.byteLength)).toEqual([6, 3]);
    expectBytesEqual(concat(parts.map((part) => part.body)), concat(source));
  });
});

describe("uploadChunksFromStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads each UPLOAD_PART_SIZE-aligned part with the right headers and reports its byte count", async () => {
    const requests: { headers: Record<string, string>; body: Uint8Array }[] =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("/api/upload/chunk");
        expect(init.method).toBe("POST");
        requests.push({
          headers: init.headers as Record<string, string>,
          body: new Uint8Array(init.body as ArrayBuffer),
        });
        return new Response(null, { status: 200 });
      })
    );

    // salt(16) + パケットのオーバーヘッドでパート境界とずれるストリームを模す。
    const source = [
      ramp(16, 1),
      ramp(UPLOAD_PART_SIZE, 2),
      ramp(UPLOAD_PART_SIZE, 3),
      ramp(1234, 4),
    ];
    const onBytesUploaded = vi.fn();

    await uploadChunksFromStream(
      fromArray(source),
      "session-1",
      "token-1",
      "some-file.bin",
      8,
      onBytesUploaded
    );

    const bodyByPart = new Map(
      requests.map((request) => [
        Number(request.headers["Anzdrop-Part-Number"]),
        request.body,
      ])
    );

    expect([...bodyByPart.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(bodyByPart.get(1)!.byteLength).toBe(UPLOAD_PART_SIZE);
    expect(bodyByPart.get(2)!.byteLength).toBe(UPLOAD_PART_SIZE);
    expect(bodyByPart.get(3)!.byteLength).toBe(16 + 1234);
    expectBytesEqual(
      concat([1, 2, 3].map((partNumber) => bodyByPart.get(partNumber)!)),
      concat(source)
    );

    for (const request of requests) {
      expect(request.headers["Anzdrop-Upload-Session"]).toBe("session-1");
      expect(request.headers["Anzdrop-Upload-Token"]).toBe("token-1");
    }

    expect(
      onBytesUploaded.mock.calls.reduce((sum, call) => sum + call[0], 0)
    ).toBe(concat(source).byteLength);
  });

  it("never runs more concurrent requests than the given concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const fetchSpy = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    // 5パート分(4 x UPLOAD_PART_SIZE + 端数)。
    const source = [
      ...Array.from({ length: 4 }, (_, i) => ramp(UPLOAD_PART_SIZE, i)),
      ramp(100),
    ];

    await uploadChunksFromStream(
      fromArray(source),
      "session-1",
      "token-1",
      "many-parts.bin",
      2,
      () => {}
    );

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("throws with the path and part number when a part upload keeps failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );

    await expect(
      uploadChunksFromStream(
        fromArray([ramp(100)]),
        "session-1",
        "token-1",
        "broken.bin",
        8,
        () => {},
        noBackoff
      )
    ).rejects.toThrow("broken.bin のパート 1 アップロードに失敗しました");
  });

  it("retries a part on a transient 503 and succeeds without failing the upload", async () => {
    let attemptsForPart1 = 0;
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const partNumber = Number(
        (init.headers as Record<string, string>)["Anzdrop-Part-Number"]
      );
      if (partNumber === 1) {
        attemptsForPart1++;
        if (attemptsForPart1 < 3) {
          return new Response(null, { status: 503 });
        }
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onBytesUploaded = vi.fn();

    await uploadChunksFromStream(
      fromArray([ramp(UPLOAD_PART_SIZE, 1), ramp(50, 2)]),
      "session-1",
      "token-1",
      "flaky.bin",
      8,
      onBytesUploaded,
      noBackoff
    );

    expect(attemptsForPart1).toBe(3);
    // 2パート分のバイト数がちょうど1回ずつ数えられている(リトライで
    // 二重カウントしない)。
    expect(
      onBytesUploaded.mock.calls.reduce((sum, call) => sum + call[0], 0)
    ).toBe(UPLOAD_PART_SIZE + 50);
  });

  it("retries a part when fetch itself throws (network drop), then recovers", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(null, { status: 200 });
      })
    );

    await expect(
      uploadChunksFromStream(
        fromArray([ramp(100)]),
        "session-1",
        "token-1",
        "recovers.bin",
        8,
        () => {},
        noBackoff
      )
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("does not retry a non-retryable 4xx (e.g. bad token) and fails fast", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts++;
        return new Response(null, { status: 403 });
      })
    );

    await expect(
      uploadChunksFromStream(
        fromArray([ramp(100)]),
        "session-1",
        "token-1",
        "forbidden.bin",
        8,
        () => {},
        noBackoff
      )
    ).rejects.toThrow("forbidden.bin のパート 1 アップロードに失敗しました");
    expect(attempts).toBe(1);
  });

  it("propagates an error thrown while generating the next chunk", async () => {
    async function* throwingGenerator(): AsyncGenerator<Uint8Array> {
      yield ramp(UPLOAD_PART_SIZE);
      throw new Error("encrypt failed");
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    await expect(
      uploadChunksFromStream(
        throwingGenerator(),
        "session-1",
        "token-1",
        "some-file.bin",
        8,
        () => {}
      )
    ).rejects.toThrow("encrypt failed");
  });

  it("converts a non-Error thrown value from the generator to a generic error", async () => {
    async function* throwingGenerator(): AsyncGenerator<Uint8Array> {
      throw "not an Error instance";
    }

    await expect(
      uploadChunksFromStream(
        throwingGenerator(),
        "session-1",
        "token-1",
        "some-file.bin",
        8,
        () => {}
      )
    ).rejects.toThrow("不明なエラー");
  });

  it("does not call the network when the stream yields no bytes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await uploadChunksFromStream(
      fromArray([new Uint8Array(0)]),
      "session-1",
      "token-1",
      "empty.bin",
      8,
      () => {}
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
