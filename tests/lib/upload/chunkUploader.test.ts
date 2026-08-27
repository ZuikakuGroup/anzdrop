import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadChunksFromStream } from "@/lib/upload/chunkUploader";

async function* fromArray(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("uploadChunksFromStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads every chunk with correct headers/body and reports each success", async () => {
    const requests: { headers: Record<string, string>; body: ArrayBuffer }[] =
      [];
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/upload/chunk");
      expect(init.method).toBe("POST");
      requests.push({
        headers: init.headers as Record<string, string>,
        body: init.body as ArrayBuffer,
      });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onChunkUploaded = vi.fn();
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
      new Uint8Array([6]),
    ];

    await uploadChunksFromStream(
      fromArray(chunks),
      "session-1",
      "token-1",
      "some-file.bin",
      onChunkUploaded
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(onChunkUploaded).toHaveBeenCalledTimes(3);

    const partNumbers = requests
      .map((r) => Number(r.headers["Anzdrop-Part-Number"]))
      .sort((a, b) => a - b);
    expect(partNumbers).toEqual([1, 2, 3]);

    for (const request of requests) {
      expect(request.headers["Anzdrop-Upload-Session"]).toBe("session-1");
      expect(request.headers["Anzdrop-Upload-Token"]).toBe("token-1");
    }

    const bodyByPart = new Map(
      requests.map((r) => [
        Number(r.headers["Anzdrop-Part-Number"]),
        new Uint8Array(r.body),
      ])
    );
    expect(bodyByPart.get(1)).toEqual(new Uint8Array([1, 2, 3]));
    expect(bodyByPart.get(2)).toEqual(new Uint8Array([4, 5]));
    expect(bodyByPart.get(3)).toEqual(new Uint8Array([6]));
  });

  it("throws with the path and part number when a chunk upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );

    await expect(
      uploadChunksFromStream(
        fromArray([new Uint8Array([1])]),
        "session-1",
        "token-1",
        "broken.bin",
        () => {}
      )
    ).rejects.toThrow("broken.bin のチャンク 1 アップロードに失敗しました");
  });

  it("propagates an error thrown while generating the next chunk", async () => {
    async function* throwingGenerator(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([1]);
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
        () => {}
      )
    ).rejects.toThrow("Unknown error");
  });

  it("does not call the network when the stream yields no chunks", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await uploadChunksFromStream(
      fromArray([]),
      "session-1",
      "token-1",
      "empty.bin",
      () => {}
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
