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
import { generateKey, encryptChunk, packChunk } from "@/lib/crypto";

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
): Promise<{ uploadSessionId: string; shareId: string }> {
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

  return readJson<{ uploadSessionId: string; shareId: string }>(response);
}

async function uploadPart(
  uploadSessionId: string,
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
      },
      body: bytes,
    })
  );
}

async function postComplete(body: unknown) {
  const { POST } = await import("./route");

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
    const { uploadSessionId, shareId } = await startUpload(
      "7d",
      "my-secret-file.enc",
      2048
    );
    const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const key = await generateKey();
    const packed = packChunk(await encryptChunk(content, key));
    await uploadPart(uploadSessionId, 1, packed.slice());

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
    const { uploadSessionId } = await startUpload("once", "one-time.enc", 1024);
    const key = await generateKey();
    const packed = packChunk(await encryptChunk(new Uint8Array([42]), key));
    await uploadPart(uploadSessionId, 1, packed.slice());

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
    const packed = packChunk(await encryptChunk(plaintext, key));
    const partA = packed.slice(0, FIVE_MIB);
    const partB = packed.slice(FIVE_MIB);

    const { uploadSessionId } = await startUpload(
      "7d",
      "multi-part.enc",
      plaintext.byteLength
    );

    // わざと逆順(part 2を先に、part 1を後に)アップロードし、
    // /api/upload/completeがpart_number順に正しく並べ直すことを検証する。
    await uploadPart(uploadSessionId, 2, partB);
    await uploadPart(uploadSessionId, 1, partA);

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

  // 413(実サイズがプラン上限を超過)の再現には、free/paidいずれのプランでも
  // 数GB〜数十GBの実データをテスト内でアップロードする必要があり、
  // MAX_FILE_SIZE_BYTES(lib/limits.ts)はテストから差し替え不可能な定数のため
  // 現実的なコストで再現できない。よってこの分岐は意図的にスキップする。
});
