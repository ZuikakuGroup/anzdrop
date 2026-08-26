import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

// このルートはgetCloudflareContext()から{ env, ctx }の両方を取り出す
// (他のルートは{ env }のみ)。ctx.waitUntilに渡されたPromiseを配列に集め、
// テスト側でawaitすることで、裏で実行される一度限りファイルの削除処理を
// 確定的に待ち合わせられるようにする。
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

async function flushWaitUntil(): Promise<void> {
  await Promise.all(waitUntilPromises);
}

type ShareOverrides = {
  id?: string;
  expiresAt?: string;
  suspendedAt?: string | null;
};

async function insertShare(overrides: ShareOverrides = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO shares (id, created_at, expires_at, suspended_at)
      VALUES (?, ?, ?, ?)
    `
  )
    .bind(
      id,
      new Date().toISOString(),
      overrides.expiresAt ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      overrides.suspendedAt ?? null
    )
    .run();

  return id;
}

type FileOverrides = {
  id?: string;
  shareId?: string;
  storageKey?: string;
  encryptedFileName?: string;
  size?: number;
  maxDownloads?: number | null;
  downloadCount?: number;
};

async function insertFile(overrides: FileOverrides = {}): Promise<{
  id: string;
  storageKey: string;
}> {
  const id = overrides.id ?? crypto.randomUUID();
  const storageKey = overrides.storageKey ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO files (
        id, share_id, storage_key, encrypted_file_name, size, max_downloads, download_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      overrides.shareId ?? "no-such-share",
      storageKey,
      overrides.encryptedFileName ?? "secret.enc",
      overrides.size ?? 1024,
      overrides.maxDownloads ?? null,
      overrides.downloadCount ?? 0,
      new Date().toISOString()
    )
    .run();

  return { id, storageKey };
}

async function getFile(fileId: string) {
  const { GET } = await import("@/app/api/file/[fileId]/route");

  return GET(new Request(`http://localhost/api/file/${fileId}`), {
    params: Promise.resolve({ fileId }),
  });
}

describe("GET /api/file/[fileId]", () => {
  it("returns 404 for an unknown fileId", async () => {
    const response = await getFile("no-such-file");

    expect(response.status).toBe(404);
  });

  // 「filesは存在するがshareが存在しない」ケース(ルート側に防御的な404分岐が
  // ある)は、このテスト環境では意図的に再現しない: filesはshares(id)への
  // 外部キー制約(ON DELETE CASCADE)を持ち、D1(Miniflareのエミュレーション含む)は
  // PRAGMA foreign_keys=OFFを単発でもバッチ内でも無視してFK制約を常に強制する
  // ため、親のないfile行をDB操作で作ること自体ができない。よってこの分岐は
  // 実運用のD1でも到達不能と考えられ、テスト対象から除外する。

  it("returns 410 for an expired share", async () => {
    const shareId = await insertShare({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { id: fileId } = await insertFile({ shareId });

    const response = await getFile(fileId);

    expect(response.status).toBe(410);
  });

  it("returns 403 for a suspended share", async () => {
    const shareId = await insertShare({
      suspendedAt: new Date().toISOString(),
    });
    const { id: fileId } = await insertFile({ shareId });

    const response = await getFile(fileId);

    expect(response.status).toBe(403);
  });

  it("serves the correct bytes and Content-Disposition header", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("hello anzdrop");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      encryptedFileName: "my file.enc",
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="my file.enc"`
    );
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content);
  });

  it("allows exactly max_downloads successful downloads, then deletes the file on the final one and rejects further attempts", async () => {
    // ルートは「上限に達した最後の1回」でファイルを削除するため、maxDownloadsの
    // 値に関わらず(1回限りでなくても)最終回のダウンロード後にR2/D1から消える。
    const shareId = await insertShare();
    const content = new TextEncoder().encode("limited content");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 3,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const first = await getFile(fileId);
    expect(first.status).toBe(200);
    await flushWaitUntil();
    const afterFirst = await env.DB.prepare(
      `SELECT download_count FROM files WHERE id = ?`
    )
      .bind(fileId)
      .first<{ download_count: number }>();
    expect(afterFirst?.download_count).toBe(1);
    expect(await env.FILES_BUCKET.get(storageKey)).not.toBeNull();

    const second = await getFile(fileId);
    expect(second.status).toBe(200);
    await flushWaitUntil();
    const afterSecond = await env.DB.prepare(
      `SELECT download_count FROM files WHERE id = ?`
    )
      .bind(fileId)
      .first<{ download_count: number }>();
    expect(afterSecond?.download_count).toBe(2);
    expect(await env.FILES_BUCKET.get(storageKey)).not.toBeNull();

    const third = await getFile(fileId);
    expect(third.status).toBe(200);
    await flushWaitUntil();

    // 3回目(上限)を消費したので、DB行・R2オブジェクトとも削除されている。
    const afterThird = await env.DB.prepare(
      `SELECT id FROM files WHERE id = ?`
    )
      .bind(fileId)
      .first();
    expect(afterThird).toBeNull();
    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();

    const fourth = await getFile(fileId);
    expect(fourth.status).toBe(404);
  });

  it("deletes a one-time file (max_downloads=1) from R2 and D1 after it is served once", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("one time secret");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content);

    await flushWaitUntil();

    const object = await env.FILES_BUCKET.get(storageKey);
    expect(object).toBeNull();

    const row = await env.DB.prepare(`SELECT id FROM files WHERE id = ?`)
      .bind(fileId)
      .first();
    expect(row).toBeNull();

    const again = await getFile(fileId);
    expect(again.status).toBe(404);
  });
});
