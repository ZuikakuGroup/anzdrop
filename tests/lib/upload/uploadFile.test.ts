import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadEncryptedFile } from "@/lib/upload/uploadFile";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";

type FetchCall = { url: string; init: RequestInit };

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    })
  );
  return { calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// テスト用の暗号化チャンクストリーム。全パケットに seed を書き込むので、
// 「どの生成回のストリームか」をバイト内容から判別できる。
function makeChunkStreamFactory(): {
  create: () => AsyncGenerator<Uint8Array>;
  createdCount: () => number;
} {
  let created = 0;
  return {
    createdCount: () => created,
    create: () => {
      created++;
      const seed = created;
      async function* gen(): AsyncGenerator<Uint8Array> {
        // 2 パート分 + 端数。
        yield new Uint8Array(UPLOAD_PART_SIZE).fill(seed);
        yield new Uint8Array(UPLOAD_PART_SIZE).fill(seed);
        yield new Uint8Array(10).fill(seed);
      }
      return gen();
    },
  };
}

const baseParams = {
  path: "photo.jpg",
  encryptedFileName: "enc-name",
  fileSize: 1000,
  retention: "7d" as const,
  shareId: undefined,
  uploadToken: undefined,
  concurrency: 4,
  onBytesUploaded: () => {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadEncryptedFile", () => {
  it("start → chunk → complete の順で送り、start が返した shareId/uploadToken を返す", async () => {
    const factory = makeChunkStreamFactory();
    const { calls } = stubFetch((url) => {
      if (url === "/api/upload/start") {
        return json({
          success: true,
          shareId: "share-xyz",
          uploadToken: "token-xyz",
          uploadSessionId: "session-xyz",
          expiresAt: "2099-01-01T00:00:00Z",
        });
      }
      if (url === "/api/upload/chunk") {
        return new Response(null, { status: 200 });
      }
      if (url === "/api/upload/complete") {
        return json({ success: true, fileId: "file-xyz" });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await uploadEncryptedFile({
      ...baseParams,
      createChunkStream: factory.create,
    });

    expect(result).toEqual({ shareId: "share-xyz", uploadToken: "token-xyz" });

    const urls = calls.map((call) => call.url);
    expect(urls[0]).toBe("/api/upload/start");
    expect(urls[urls.length - 1]).toBe("/api/upload/complete");
    expect(urls).toContain("/api/upload/chunk");

    // チャンク送信のセッションヘッダは start が返した uploadSessionId。
    const chunkCall = calls.find((call) => call.url === "/api/upload/chunk")!;
    expect(
      (chunkCall.init.headers as Record<string, string>)[
        "Anzdrop-Upload-Session"
      ]
    ).toBe("session-xyz");

    // ストリームは1回だけ生成される。
    expect(factory.createdCount()).toBe(1);
  });

  it("start が失敗したらチャンク送信も complete も呼ばずに throw する", async () => {
    const factory = makeChunkStreamFactory();
    const { calls } = stubFetch((url) => {
      if (url === "/api/upload/start") {
        return json({ success: false, error: "容量オーバー" }, 400);
      }
      throw new Error(`should not call ${url}`);
    });

    await expect(
      uploadEncryptedFile({ ...baseParams, createChunkStream: factory.create })
    ).rejects.toThrow("容量オーバー");

    expect(calls.map((call) => call.url)).toEqual(["/api/upload/start"]);
    expect(factory.createdCount()).toBe(0);
  });

  it("start が非JSONエラーを返したら既定の開始失敗メッセージで throw する", async () => {
    const factory = makeChunkStreamFactory();
    const { calls } = stubFetch(() =>
      new Response("Bad Gateway", { status: 502 })
    );

    await expect(
      uploadEncryptedFile({ ...baseParams, createChunkStream: factory.create })
    ).rejects.toThrow("photo.jpg の開始に失敗しました");

    expect(calls.map((call) => call.url)).toEqual(["/api/upload/start"]);
    expect(factory.createdCount()).toBe(0);
  });

  it("complete が失敗したら throw する", async () => {
    const factory = makeChunkStreamFactory();
    stubFetch((url) => {
      if (url === "/api/upload/start") {
        return json({
          success: true,
          shareId: "s",
          uploadToken: "t",
          uploadSessionId: "sess",
        });
      }
      if (url === "/api/upload/chunk") {
        return new Response(null, { status: 200 });
      }
      return json({ success: false, error: "パートが足りません" }, 400);
    });

    await expect(
      uploadEncryptedFile({ ...baseParams, createChunkStream: factory.create })
    ).rejects.toThrow("パートが足りません");
  });

  it("complete が非JSONエラーを返したら既定の完了失敗メッセージで throw する", async () => {
    const factory = makeChunkStreamFactory();
    stubFetch((url) => {
      if (url === "/api/upload/start") {
        return json({
          success: true,
          shareId: "s",
          uploadToken: "t",
          uploadSessionId: "sess",
        });
      }
      if (url === "/api/upload/chunk") {
        return new Response(null, { status: 200 });
      }
      return new Response("Bad Gateway", { status: 502 });
    });

    await expect(
      uploadEncryptedFile({ ...baseParams, createChunkStream: factory.create })
    ).rejects.toThrow("photo.jpg の完了処理に失敗しました");
  });

  it("リトライで呼び直すと毎回ストリームを作り直し、2 回目も先頭パートから送る (#58)", async () => {
    const factory = makeChunkStreamFactory();

    // 1 回目: チャンク送信を再送しても直らない失敗(403)で即座に失敗させる。
    let firstAttemptChunkCalls = 0;
    stubFetch((url) => {
      if (url === "/api/upload/start") {
        return json({
          success: true,
          shareId: "s1",
          uploadToken: "t1",
          uploadSessionId: "sess-1",
        });
      }
      if (url === "/api/upload/chunk") {
        firstAttemptChunkCalls++;
        return new Response(null, { status: 403 });
      }
      return json({ success: true });
    });

    await expect(
      uploadEncryptedFile({ ...baseParams, createChunkStream: factory.create })
    ).rejects.toThrow();

    expect(firstAttemptChunkCalls).toBeGreaterThan(0);
    expect(factory.createdCount()).toBe(1);

    // 2 回目: 今度は成功させ、送られてくるチャンクの seed が「2」で
    //         あること(＝新しいストリーム)と、パート番号が 1 から
    //         始まっていることを確認する。
    const secondAttemptParts: { partNumber: number; firstByte: number }[] = [];
    stubFetch((url, init) => {
      if (url === "/api/upload/start") {
        return json({
          success: true,
          shareId: "s1",
          uploadToken: "t1",
          uploadSessionId: "sess-2",
        });
      }
      if (url === "/api/upload/chunk") {
        const headers = init.headers as Record<string, string>;
        const body = new Uint8Array(init.body as ArrayBuffer);
        secondAttemptParts.push({
          partNumber: Number(headers["Anzdrop-Part-Number"]),
          firstByte: body[0],
        });
        return new Response(null, { status: 200 });
      }
      return json({ success: true });
    });

    const result = await uploadEncryptedFile({
      ...baseParams,
      shareId: "s1",
      uploadToken: "t1",
      createChunkStream: factory.create,
    });

    expect(result.shareId).toBe("s1");
    expect(factory.createdCount()).toBe(2);

    const partNumbers = secondAttemptParts
      .map((part) => part.partNumber)
      .sort((a, b) => a - b);
    expect(partNumbers).toEqual([1, 2, 3]);
    // 2 回目のストリーム(seed=2)のバイトが送られている。
    for (const part of secondAttemptParts) {
      expect(part.firstByte).toBe(2);
    }
  });
});
