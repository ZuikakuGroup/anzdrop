import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import { deleteShare, cleanupExpiredShares, cleanupStaleUploads } from "@/lib/cleanup";

let env: TestEnv;
let dispose: () => Promise<void>;

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
});

async function insertShare(overrides: { id: string; expiresAt?: string }) {
  await env.DB.prepare(
    `INSERT INTO shares (id, created_at, expires_at) VALUES (?, ?, ?)`
  )
    .bind(
      overrides.id,
      new Date().toISOString(),
      overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString()
    )
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

async function insertUpload(overrides: {
  id: string;
  shareId: string;
  storageKey: string;
  uploadId: string;
  createdAt?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO uploads (id, share_id, storage_key, upload_id, encrypted_file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      overrides.id,
      overrides.shareId,
      overrides.storageKey,
      overrides.uploadId,
      "encrypted-name",
      overrides.createdAt ?? new Date().toISOString()
    )
    .run();
}

async function insertUploadPart(uploadSessionId: string, partNumber = 1) {
  await env.DB.prepare(
    `INSERT INTO upload_parts (upload_session_id, part_number, etag) VALUES (?, ?, ?)`
  )
    .bind(uploadSessionId, partNumber, `etag-${partNumber}`)
    .run();
}

async function uploadExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM uploads WHERE id = ?`)
    .bind(id)
    .first();

  return row !== null;
}

async function uploadPartsCountFor(uploadSessionId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM upload_parts WHERE upload_session_id = ?`
  )
    .bind(uploadSessionId)
    .first<{ count: number }>();

  return row?.count ?? 0;
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

describe("deleteShare", () => {
  it("removes R2 objects and all 4 related DB tables' rows for the share", async () => {
    const shareId = "share-1";
    const storageKey = `files/${shareId}/file-1`;
    await insertShare({ id: shareId });
    await insertFile(shareId, storageKey);
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([1, 2, 3]));

    const uploadId = "upload-1";
    await insertUpload({
      id: uploadId,
      shareId,
      storageKey: `files/${shareId}/other`,
      uploadId: "irrelevant-r2-upload-id",
    });
    await insertUploadPart(uploadId);

    expect((await env.FILES_BUCKET.get(storageKey)) !== null).toBe(true);

    await deleteShare(env, shareId);

    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();
    expect(await filesCountFor(shareId)).toBe(0);
    expect(await uploadExists(uploadId)).toBe(false);
    expect(await uploadPartsCountFor(uploadId)).toBe(0);
    expect(await shareExists(shareId)).toBe(false);
  });

  it("is a safe no-op for a shareId that does not exist", async () => {
    await expect(deleteShare(env, "no-such-share")).resolves.not.toThrow();
  });

  it("aborts an in-progress multipart upload and removes its uploads row", async () => {
    const shareId = "share-multipart";
    const storageKey = `files/${shareId}/incomplete`;
    await insertShare({ id: shareId });

    const multipart = await env.FILES_BUCKET.createMultipartUpload(
      storageKey
    );
    const part = await multipart.uploadPart(
      1,
      new TextEncoder().encode("partial content")
    );
    // わざとcomplete/abortしないまま、DB上のuploads行だけ作る。
    await insertUpload({
      id: "upload-incomplete",
      shareId,
      storageKey,
      uploadId: multipart.uploadId,
    });

    await expect(deleteShare(env, shareId)).resolves.not.toThrow();

    expect(await uploadExists("upload-incomplete")).toBe(false);

    // DB行が消えているだけでなく、R2側でも実際にabortされ、もはや
    // このuploadIdでは完了できなくなっていることまで確認する
    // (abortMultipartUpload呼び出し自体が実装から失われていないことの検証)。
    await expect(
      env.FILES_BUCKET.resumeMultipartUpload(
        storageKey,
        multipart.uploadId
      ).complete([{ partNumber: 1, etag: part.etag }])
    ).rejects.toThrow();
  });

  it("still deletes DB rows even when aborting the multipart upload fails", async () => {
    // lib/cleanup.tsのabortMultipartUploadはtry/catchで例外を握りつぶす設計
    // (既に完了/中断済みなどでR2側が失敗しても、DBの掃除自体は継続すべきため)。
    // 実在しないuploadIdへのabortは実際にR2側がエラーを返すため、
    // その保証を検証できる。
    const shareId = "share-abort-fails";
    await insertShare({ id: shareId });
    await insertUpload({
      id: "upload-bad",
      shareId,
      storageKey: "files/does-not-matter",
      uploadId: "totally-bogus-upload-id-that-was-never-created",
    });

    await expect(deleteShare(env, shareId)).resolves.not.toThrow();

    expect(await uploadExists("upload-bad")).toBe(false);
    expect(await shareExists(shareId)).toBe(false);
  });
});

describe("cleanupExpiredShares", () => {
  it("deletes expired shares and their files while leaving non-expired shares untouched", async () => {
    const expiredId = "share-expired";
    const expiredKey = `files/${expiredId}/file`;
    await insertShare({
      id: expiredId,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await insertFile(expiredId, expiredKey);
    await env.FILES_BUCKET.put(expiredKey, new Uint8Array([9]));

    const activeId = "share-active";
    const activeKey = `files/${activeId}/file`;
    await insertShare({
      id: activeId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await insertFile(activeId, activeKey);
    await env.FILES_BUCKET.put(activeKey, new Uint8Array([9]));

    await cleanupExpiredShares(env);

    expect(await shareExists(expiredId)).toBe(false);
    expect(await env.FILES_BUCKET.get(expiredKey)).toBeNull();

    expect(await shareExists(activeId)).toBe(true);
    expect((await env.FILES_BUCKET.get(activeKey)) !== null).toBe(true);
  });
});

describe("cleanupStaleUploads", () => {
  it("deletes only upload sessions older than 24 hours, leaving shares/files untouched", async () => {
    const shareId = "share-with-uploads";
    // このシェア自体はまだ有効期限内(cleanupStaleUploadsはsharesを見ないことの確認も兼ねる)。
    await insertShare({
      id: shareId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const staleId = "upload-stale";
    const staleCreatedAt = new Date(
      Date.now() - 25 * 60 * 60 * 1000
    ).toISOString();
    await insertUpload({
      id: staleId,
      shareId,
      storageKey: `files/${shareId}/stale`,
      uploadId: "r2-upload-stale",
      createdAt: staleCreatedAt,
    });
    await insertUploadPart(staleId);

    const freshId = "upload-fresh";
    await insertUpload({
      id: freshId,
      shareId,
      storageKey: `files/${shareId}/fresh`,
      uploadId: "r2-upload-fresh",
      createdAt: new Date().toISOString(),
    });
    await insertUploadPart(freshId);

    await cleanupStaleUploads(env);

    expect(await uploadExists(staleId)).toBe(false);
    expect(await uploadPartsCountFor(staleId)).toBe(0);

    expect(await uploadExists(freshId)).toBe(true);
    expect(await uploadPartsCountFor(freshId)).toBe(1);

    // shares/filesテーブルには触れないことの確認。
    expect(await shareExists(shareId)).toBe(true);
  });
});
