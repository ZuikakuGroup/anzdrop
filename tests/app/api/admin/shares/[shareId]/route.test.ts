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
import { verifyAccessJwt } from "@/lib/access";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();

  return {
    ...actual,
    verifyAccessJwt: vi.fn(),
  };
});

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
  vi.mocked(verifyAccessJwt).mockReset();
});

function authorize() {
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
}

async function deleteShareRoute(
  shareId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { DELETE } = await import("@/app/api/admin/shares/[shareId]/route");

  return DELETE(
    new Request(`http://localhost/api/admin/shares/${shareId}`, {
      method: "DELETE",
      headers,
    }),
    { params: Promise.resolve({ shareId }) }
  );
}

async function getShareRoute(shareId: string): Promise<Response> {
  const { GET } = await import("@/app/api/admin/shares/[shareId]/route");

  return GET(new Request(`http://localhost/api/admin/shares/${shareId}`), {
    params: Promise.resolve({ shareId }),
  });
}

async function insertShare(id: string) {
  await env.DB.prepare(
    `INSERT INTO shares (id, created_at, expires_at) VALUES (?, ?, ?)`
  )
    .bind(id, new Date().toISOString(), new Date(Date.now() + 60_000).toISOString())
    .run();
}

async function insertFile(shareId: string, storageKey: string) {
  await env.DB.prepare(
    `INSERT INTO files (id, share_id, storage_key, encrypted_file_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      shareId,
      storageKey,
      "encrypted-name",
      1234,
      new Date().toISOString()
    )
    .run();
}

async function insertUpload(shareId: string, uploadIdRow: string, storageKey: string) {
  await env.DB.prepare(
    `INSERT INTO uploads (id, share_id, storage_key, upload_id, encrypted_file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      uploadIdRow,
      shareId,
      storageKey,
      "irrelevant-r2-upload-id",
      "encrypted-name",
      new Date().toISOString()
    )
    .run();
}

async function shareExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM shares WHERE id = ?`)
    .bind(id)
    .first();

  return row !== null;
}

async function filesCountFor(shareId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM files WHERE share_id = ?`
  )
    .bind(shareId)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function uploadsCountFor(shareId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM uploads WHERE share_id = ?`
  )
    .bind(shareId)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

describe("DELETE /api/admin/shares/[shareId]", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertShare("share-1");

    const response = await deleteShareRoute("share-1");

    expect(response.status).toBe(403);
    expect(await shareExists("share-1")).toBe(true);
  });

  it("removes R2 objects and all associated DB rows across files/uploads/upload_parts/shares, without touching an unrelated share", async () => {
    authorize();
    const shareId = "share-with-files";
    const storageKey = `files/${shareId}/file-1`;
    await insertShare(shareId);
    await insertFile(shareId, storageKey);
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([1, 2, 3, 4]));

    // 削除対象とは無関係の共有。DELETEのスコープ漏れがあればここで検出できる。
    const otherShareId = "share-untouched";
    const otherStorageKey = `files/${otherShareId}/file-1`;
    await insertShare(otherShareId);
    await insertFile(otherShareId, otherStorageKey);
    await env.FILES_BUCKET.put(otherStorageKey, new Uint8Array([9, 9]));

    const uploadId = "upload-row-1";
    await insertUpload(shareId, uploadId, `files/${shareId}/other`);
    await env.DB.prepare(
      `INSERT INTO upload_parts (upload_session_id, part_number, etag) VALUES (?, 1, 'etag-1')`
    )
      .bind(uploadId)
      .run();

    expect((await env.FILES_BUCKET.get(storageKey)) !== null).toBe(true);

    const response = await deleteShareRoute(shareId);
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();
    expect(await filesCountFor(shareId)).toBe(0);
    expect(await uploadsCountFor(shareId)).toBe(0);
    expect(await shareExists(shareId)).toBe(false);

    const remainingParts = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM upload_parts WHERE upload_session_id = ?`
    )
      .bind(uploadId)
      .first<{ count: number }>();
    expect(remainingParts?.count).toBe(0);

    expect(await shareExists(otherShareId)).toBe(true);
    expect(await filesCountFor(otherShareId)).toBe(1);
    expect((await env.FILES_BUCKET.get(otherStorageKey)) !== null).toBe(true);
  });

  it("returns 403 and does not delete when the Origin header is a different site (CSRF)", async () => {
    authorize();
    await insertShare("share-1");

    const response = await deleteShareRoute("share-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await shareExists("share-1")).toBe(true);
  });

  it("is idempotent: deleting a non-existent shareId still returns success", async () => {
    authorize();

    const response = await deleteShareRoute("no-such-share");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("GET /api/admin/shares/[shareId]", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);

    const response = await getShareRoute("share-1");

    expect(response.status).toBe(403);
  });

  it("returns exists: false for a shareId with no matching share", async () => {
    authorize();

    const response = await getShareRoute("no-such-share");
    const body = (await response.json()) as {
      success: boolean;
      share: { exists: boolean; expired: boolean; suspended: boolean; fileCount: number };
    };

    expect(response.status).toBe(200);
    expect(body.share).toEqual({
      exists: false,
      expired: false,
      suspended: false,
      fileCount: 0,
    });
  });

  it("reports an existing, non-suspended share with its file count", async () => {
    authorize();
    const shareId = "share-active";
    await insertShare(shareId);
    await insertFile(shareId, `files/${shareId}/file-1`);
    await insertFile(shareId, `files/${shareId}/file-2`);

    const response = await getShareRoute(shareId);
    const body = (await response.json()) as {
      share: { exists: boolean; expired: boolean; suspended: boolean; fileCount: number };
    };

    expect(body.share).toEqual({
      exists: true,
      expired: false,
      suspended: false,
      fileCount: 2,
    });
  });

  it("reports a suspended share as suspended", async () => {
    authorize();
    const shareId = "share-suspended";
    await insertShare(shareId);
    await env.DB.prepare(`UPDATE shares SET suspended_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), shareId)
      .run();

    const response = await getShareRoute(shareId);
    const body = (await response.json()) as {
      share: { suspended: boolean };
    };

    expect(body.share.suspended).toBe(true);
  });

  it("reports an expired share as expired", async () => {
    authorize();
    const shareId = "share-expired";
    await env.DB.prepare(
      `INSERT INTO shares (id, created_at, expires_at) VALUES (?, ?, ?)`
    )
      .bind(
        shareId,
        new Date(Date.now() - 120_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString()
      )
      .run();

    const response = await getShareRoute(shareId);
    const body = (await response.json()) as {
      share: { expired: boolean };
    };

    expect(body.share.expired).toBe(true);
  });
});
