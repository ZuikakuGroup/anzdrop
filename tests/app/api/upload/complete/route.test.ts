import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestEnv,
  clearAllTables,
  stubTurnstileSuccess,
  readJson,
  type TestEnv,
} from "@/test/env";
import type { Retention } from "@/lib/retention";
import {
  generateKey,
  iterateDecryptedChunks,
  iterateEncryptedChunks,
} from "@/lib/crypto";
import { uploadChunksFromStream } from "@/lib/upload/chunkUploader";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";

// iterateEncryptedChunks(実際にクライアントが送信するのと同じ形式:先頭に
// ファイルsaltを含む)で単一ファイルを暗号化し、その唯一のパケットを返す。
// このヘルパーはCHUNK_SIZE未満の単一パケットのテストデータ専用のため、
// 万一テストデータがCHUNK_SIZEを超えて複数パケットに分かれた場合は、
// 呼び出し側が2つ目以降を黙って無視してしまわないようここで検知する。
async function encryptAsSingleFile(
  content: Uint8Array<ArrayBuffer>,
  key: CryptoKey
): Promise<Uint8Array> {
  const file = new File([content], "content.bin");
  const packets: Uint8Array[] = [];

  for await (const packet of iterateEncryptedChunks(file, key)) {
    packets.push(packet);
  }

  expect(packets.length).toBe(1);

  return packets[0];
}

let env: TestEnv;
let dispose: () => Promise<void>;

// app/api/file/[fileId]はgetCloudflareContext()から{ env, ctx }を取り出すため、
// このファイルの末尾でダウンロードまで通しで検証するテストのために両方渡す。
let waitUntilPromises: Promise<unknown>[];

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    },
  }),
}));

beforeAll(async () => {
  const handle = await createTestEnv();
  env = handle.env;
  dispose = handle.dispose;
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await clearAllTables(env);
  waitUntilPromises = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// app/api/upload/start -> app/api/upload/chunk を実際に叩き、本物のR2マルチ
// パートアップロード(uploadId/etag)を伴うアップロードセッションを用意する。
async function startUpload(
  retention: Retention = "7d",
  encryptedFileName = "file.enc",
  fileSize = 2048
): Promise<{ uploadSessionId: string; shareId: string; uploadToken: string }> {
  stubTurnstileSuccess();
  const { POST } = await import("@/app/api/upload/start/route");
  const response = await POST(
    new Request("http://localhost/api/upload/start", {
      method: "POST",
      body: JSON.stringify({
        encryptedFileName,
        fileSize,
        retention,
        turnstileToken: "tok",
      }),
    })
  );

  return readJson<{
    uploadSessionId: string;
    shareId: string;
    uploadToken: string;
  }>(response);
}

async function uploadPart(
  uploadSessionId: string,
  uploadToken: string,
  partNumber: number,
  bytes: BodyInit
) {
  const { POST } = await import("@/app/api/upload/chunk/route");

  return POST(
    new Request("http://localhost/api/upload/chunk", {
      method: "POST",
      headers: {
        "Anzdrop-Upload-Session": uploadSessionId,
        "Anzdrop-Part-Number": String(partNumber),
        "Anzdrop-Upload-Token": uploadToken,
      },
      body: bytes,
    })
  );
}

async function postComplete(body: unknown) {
  const { POST } = await import("@/app/api/upload/complete/route");

  return POST(
    new Request("http://localhost/api/upload/complete", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/upload/complete", () => {
  it("returns 400 when uploadSessionId is missing", async () => {
    const response = await postComplete({});

    expect(response.status).toBe(400);
  });

  it("returns 400 when uploadSessionId is an empty string", async () => {
    const response = await postComplete({ uploadSessionId: "" });

    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown uploadSessionId", async () => {
    const response = await postComplete({ uploadSessionId: "no-such-session" });

    expect(response.status).toBe(404);
  });

  it("returns 400 when there are zero uploaded parts", async () => {
    const { uploadSessionId } = await startUpload();

    const response = await postComplete({ uploadSessionId });

    expect(response.status).toBe(400);

    // 失敗時にはセッションを消してはいけない(クライアントが再試行できるように)。
    const upload = await env.DB.prepare(
      `SELECT id FROM uploads WHERE id = ?`
    )
      .bind(uploadSessionId)
      .first();
    expect(upload).toBeTruthy();
  });

  it("creates the files row and cleans up the upload session on success", async () => {
    const { uploadSessionId, shareId, uploadToken } = await startUpload(
      "7d",
      "my-secret-file.enc",
      2048
    );
    const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const key = await generateKey();
    const packed = await encryptAsSingleFile(content, key);
    await uploadPart(uploadSessionId, uploadToken, 1, packed.slice());

    const response = await postComplete({ uploadSessionId });

    expect(response.status).toBe(200);
    const body = await readJson<{ success: boolean; fileId: string }>(
      response
    );
    expect(body.success).toBe(true);
    expect(typeof body.fileId).toBe("string");

    const file = await env.DB.prepare(
      `SELECT share_id, encrypted_file_name, size, max_downloads FROM files WHERE id = ?`
    )
      .bind(body.fileId)
      .first<{
        share_id: string;
        encrypted_file_name: string;
        size: number;
        max_downloads: number | null;
      }>();
    expect(file?.share_id).toBe(shareId);
    expect(file?.encrypted_file_name).toBe("my-secret-file.enc");
    expect(file?.size).toBe(content.byteLength);
    expect(file?.max_downloads).toBeNull();

    // アップロードセッション・パートの後始末が行われていること。
    const upload = await env.DB.prepare(`SELECT id FROM uploads WHERE id = ?`)
      .bind(uploadSessionId)
      .first();
    expect(upload).toBeNull();

    const { results: parts } = await env.DB.prepare(
      `SELECT part_number FROM upload_parts WHERE upload_session_id = ?`
    )
      .bind(uploadSessionId)
      .all();
    expect(parts).toHaveLength(0);
  });

  it("sets max_downloads=1 on the files row for 'once' retention", async () => {
    const { uploadSessionId, uploadToken } = await startUpload(
      "once",
      "one-time.enc",
      1024
    );
    const key = await generateKey();
    const packed = await encryptAsSingleFile(new Uint8Array([42]), key);
    await uploadPart(uploadSessionId, uploadToken, 1, packed.slice());

    const response = await postComplete({ uploadSessionId });
    expect(response.status).toBe(200);
    const body = await readJson<{ fileId: string }>(response);

    const file = await env.DB.prepare(
      `SELECT max_downloads FROM files WHERE id = ?`
    )
      .bind(body.fileId)
      .first<{ max_downloads: number | null }>();
    expect(file?.max_downloads).toBe(1);
  });

  it("reassembles multiple parts in the correct order end-to-end (upload -> complete -> download byte-for-byte)", async () => {
    // R2(Miniflareのエミュレーションも含む)は、マルチパートアップロードの
    // 最終パート以外は最小5MiB以上でなければcomplete()が失敗するため、
    // 1パケット分の暗号文(5MiB+5バイトの平文をAES-GCMで暗号化したもの)を
    // ちょうどpart 1が5MiBになる位置で2つに分割する。
    const FIVE_MIB = 5 * 1024 * 1024;
    const plaintext = new Uint8Array(FIVE_MIB + 5);
    plaintext.fill(0xaa);
    const key = await generateKey();
    const packed = await encryptAsSingleFile(plaintext, key);
    const partA = packed.slice(0, FIVE_MIB);
    const partB = packed.slice(FIVE_MIB);

    const { uploadSessionId, uploadToken } = await startUpload(
      "7d",
      "multi-part.enc",
      plaintext.byteLength
    );

    // わざと逆順(part 2を先に、part 1を後に)アップロードし、
    // /api/upload/completeがpart_number順に正しく並べ直すことを検証する。
    await uploadPart(uploadSessionId, uploadToken, 2, partB);
    await uploadPart(uploadSessionId, uploadToken, 1, partA);

    const response = await postComplete({ uploadSessionId });
    expect(response.status).toBe(200);
    const body = await readJson<{ fileId: string }>(response);

    const { GET: downloadFile } = await import("@/app/api/file/[fileId]/route");
    const downloadResponse = await downloadFile(
      new Request(`http://localhost/api/file/${body.fileId}`),
      { params: Promise.resolve({ fileId: body.fileId }) }
    );
    expect(downloadResponse.status).toBe(200);

    const downloaded = new Uint8Array(await downloadResponse.arrayBuffer());
    expect(downloaded).toEqual(packed);

    await Promise.all(waitUntilPromises);
  });

  // GitHub issue #34 の回帰テスト。
  //
  // 暗号化ストリームは先頭パケットにだけファイルsalt(16B)が付くため、
  // 修正前のクライアントのように「1パケット=1パート」で送ると先頭パートだけが
  // 他より16B大きくなり、3パート以上(平文16MiB超)のアップロードで
  // R2 の complete() が「最終パート以外は同一サイズ」制約に違反して失敗し、
  // 500(「サーバー内部でエラーが発生しました」)になっていた。
  //
  // 実際のクライアント経路(iterateEncryptedChunks → uploadChunksFromStream →
  // /api/upload/chunk)をそのまま駆動し、chunk が均一サイズのパートに詰め直され、
  // complete・ダウンロード・復号まで通ることを検証する。
  it("uploads a file spanning 3+ uniform R2 parts end-to-end via the real client path (issue #34)", async () => {
    // 平文を 2 * UPLOAD_PART_SIZE + 1 にすると、iterateEncryptedChunks は
    // 3 パケット(8MiB + 8MiB + 1B の平文それぞれに IV/GCMタグ、先頭は salt 付き)を
    // 生成する。修正前の「1パケット=1パート」方式では先頭パートだけ salt(16B) の
    // 分だけ大きくなり、非最終パートが 2 つ(先頭と 2 番目)できて不均一になるため
    // R2 の complete() が「最終パート以外は同一サイズ」制約に違反して失敗した
    // (= issue #34 の条件)。ちょうど 2 * UPLOAD_PART_SIZE(2 パケット)だと
    // 非最終パートが先頭 1 つだけで制約を自明に満たしてしまい、回帰を再現できない。
    // 修正後は repartition が [8MiB, 8MiB, 残り] の3パートに詰め直す
    // (非最終パート均一・最終パート極小)。
    const plaintextSize = 2 * UPLOAD_PART_SIZE + 1;
    const plaintext = new Uint8Array(plaintextSize);
    for (let i = 0; i < plaintextSize; i++) {
      plaintext[i] = (i * 7 + 13) & 0xff;
    }

    const key = await generateKey();
    const { uploadSessionId, uploadToken } = await startUpload(
      "7d",
      "big.enc",
      plaintextSize
    );

    // uploadChunksFromStream が呼ぶ fetch("/api/upload/chunk", ...) を、
    // 実際の chunk ルートハンドラへ転送する。
    const { POST: chunkRoute } = await import("@/app/api/upload/chunk/route");
    const seenPartSizes: number[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit): Promise<Response> => {
        expect(url).toBe("/api/upload/chunk");
        const body = init.body as ArrayBuffer;
        seenPartSizes.push(body.byteLength);
        return chunkRoute(
          new Request("http://localhost/api/upload/chunk", {
            method: "POST",
            headers: init.headers as Record<string, string>,
            body,
          })
        );
      }
    );

    const file = new File([plaintext], "big.bin");
    await uploadChunksFromStream(
      iterateEncryptedChunks(file, key),
      uploadSessionId,
      uploadToken,
      "big.bin",
      8,
      () => {}
    );

    vi.unstubAllGlobals();

    // 非最終パートは均一な UPLOAD_PART_SIZE、最終パートだけが小さい = #34 の条件。
    const bySize = [...seenPartSizes].sort((a, b) => b - a);
    expect(seenPartSizes).toHaveLength(3);
    expect(bySize[0]).toBe(UPLOAD_PART_SIZE);
    expect(bySize[1]).toBe(UPLOAD_PART_SIZE);
    expect(bySize[2]).toBeLessThan(UPLOAD_PART_SIZE);

    const response = await postComplete({ uploadSessionId });
    expect(response.status).toBe(200);
    const completeBody = await readJson<{ success: boolean; fileId: string }>(
      response
    );
    expect(completeBody.success).toBe(true);

    // 保存された平文サイズが元に一致する(暗号文サイズからの逆算)。
    const fileRow = await env.DB.prepare(`SELECT size FROM files WHERE id = ?`)
      .bind(completeBody.fileId)
      .first<{ size: number }>();
    expect(fileRow?.size).toBe(plaintextSize);

    // ダウンロードして復号すると元の平文にバイト単位で一致する。
    const { GET: downloadFile } = await import("@/app/api/file/[fileId]/route");
    const downloadResponse = await downloadFile(
      new Request(`http://localhost/api/file/${completeBody.fileId}`),
      { params: Promise.resolve({ fileId: completeBody.fileId }) }
    );
    expect(downloadResponse.status).toBe(200);

    const decryptedPieces: Uint8Array[] = [];
    for await (const piece of iterateDecryptedChunks(
      downloadResponse.body as ReadableStream<Uint8Array>,
      key,
      plaintextSize
    )) {
      decryptedPieces.push(piece);
    }
    const decrypted = new Uint8Array(
      decryptedPieces.reduce((sum, piece) => sum + piece.byteLength, 0)
    );
    let decryptedOffset = 0;
    for (const piece of decryptedPieces) {
      decrypted.set(piece, decryptedOffset);
      decryptedOffset += piece.byteLength;
    }
    // 多MB配列への toEqual はこの環境でヒープを食い潰すためバイト比較する。
    expect(decrypted.byteLength).toBe(plaintext.byteLength);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);

    await Promise.all(waitUntilPromises);
  }, 120_000);

  // 413(実サイズがプラン上限を超過)の再現には、free/paidいずれのプランでも
  // 数GB〜数十GBの実データをテスト内でアップロードする必要があり、
  // MAX_FILE_SIZE_BYTES(lib/limits.ts)はテストから差し替え不可能な定数のため
  // 現実的なコストで再現できない。よってこの分岐は意図的にスキップする。
});
