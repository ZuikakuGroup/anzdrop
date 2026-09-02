import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import {
  deleteShare,
  cleanupExpiredShares,
  cleanupStaleUploads,
  runScheduledCleanup,
} from "@/lib/cleanup";

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

// Miniflare の D1/R2 バインディングはマジックプロキシで、プロパティ代入で
// メソッドを差し替えられない。テスト用に一部メソッドだけ挙動を変えたいときは、
// 実バインディングを Proxy でくるみ、その他のメソッドはそのまま委譲する
// 「壊れた env」を1回だけ作って渡す(共有 env は一切変更しない)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Miniflare バインディングの型に合わせるため
function wrapBinding<T extends object>(target: T, overrides: Record<string, any>): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && prop in overrides) {
        return overrides[prop];
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}

// 指定した storage_key を(単体・配列いずれの delete 呼び出しでも)含む場合に
// R2 削除を失敗させる env。deleteShare はファイルの storage_key 配列を1回の
// delete([...]) で消すため、配列にターゲットが混ざっていたら失敗させる。
function envWithFailingBucketDeleteFor(
  ...targetKeys: string[]
): TestEnv {
  const targets = new Set(targetKeys);
  const bucket = wrapBinding(env.FILES_BUCKET, {
    delete: async (keys: string | string[]) => {
      const asArray = Array.isArray(keys) ? keys : [keys];
      if (asArray.some((key) => targets.has(key))) {
        throw new Error(
          `simulated R2 delete failure for ${asArray.join(",")}`
        );
      }
      return (env.FILES_BUCKET.delete as (k: string | string[]) => Promise<void>)(
        keys
      );
    },
  });

  return { ...(env as object), FILES_BUCKET: bucket } as TestEnv;
}

// env.DB.batch を必ず失敗させる env(SELECT などの prepare/all は通す)。
// 放置アップロード削除(deleteStaleUpload)の失敗経路の検証に使う。
function envWithFailingDbBatch(): TestEnv {
  const db = wrapBinding(env.DB, {
    batch: async () => {
      throw new Error("simulated D1 batch failure");
    },
  });

  return { ...(env as object), DB: db } as TestEnv;
}

// 期限切れ共有の抽出クエリだけを throw させる env(その他のクエリは通す)。
function envWithFailingSharesExpiryQuery(): TestEnv {
  const db = wrapBinding(env.DB, {
    prepare: (query: string) => {
      if (query.includes("FROM shares WHERE expires_at")) {
        throw new Error("simulated D1 failure");
      }
      return (env.DB.prepare as (q: string) => unknown)(query);
    },
  });

  return { ...(env as object), DB: db } as TestEnv;
}

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

describe("cleanupExpiredShares — 耐障害性とバッチ処理", () => {
  it("1件の削除失敗があっても、残りの期限切れ共有は削除され失敗件数が報告される", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    const failingId = "share-fails";
    const failingKey = `files/${failingId}/file`;
    await insertShare({ id: failingId, expiresAt: past });
    await insertFile(failingId, failingKey);
    await env.FILES_BUCKET.put(failingKey, new Uint8Array([1]));

    const okId = "share-ok";
    const okKey = `files/${okId}/file`;
    await insertShare({ id: okId, expiresAt: past });
    await insertFile(okId, okKey);
    await env.FILES_BUCKET.put(okKey, new Uint8Array([2]));

    const result = await cleanupExpiredShares(
      envWithFailingBucketDeleteFor(failingKey)
    );

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);

    // 失敗した共有は残り、健全な共有は消えている。
    expect(await shareExists(failingId)).toBe(true);
    expect(await shareExists(okId)).toBe(false);
    expect(await env.FILES_BUCKET.get(okKey)).toBeNull();
  });

  it("全件が失敗しても無限ループにならず、その回の実行は終了する", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const id = "share-always-fails";
    const key = `files/${id}/file`;
    await insertShare({ id, expiresAt: past });
    await insertFile(id, key);
    await env.FILES_BUCKET.put(key, new Uint8Array([1]));

    const result = await cleanupExpiredShares(
      envWithFailingBucketDeleteFor(key),
      { queryLimit: 1, maxBatches: 5 }
    );

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(await shareExists(id)).toBe(true);
  });

  it("1バッチのLIMITを超える期限切れ共有を、複数バッチに分けて全件処理する", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    for (let i = 0; i < 5; i++) {
      await insertShare({ id: `bulk-${i}`, expiresAt: past });
    }

    const result = await cleanupExpiredShares(env, {
      queryLimit: 2,
      maxBatches: 10,
    });

    expect(result.processed).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.reachedBatchLimit).toBe(false);

    for (let i = 0; i < 5; i++) {
      expect(await shareExists(`bulk-${i}`)).toBe(false);
    }
  });

  it("バッチ数の上限に達すると未処理を残し reachedBatchLimit を立てる", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    for (let i = 0; i < 5; i++) {
      await insertShare({ id: `capped-${i}`, expiresAt: past });
    }

    const result = await cleanupExpiredShares(env, {
      queryLimit: 2,
      maxBatches: 2,
    });

    expect(result.processed).toBe(4);
    expect(result.reachedBatchLimit).toBe(true);

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM shares`
    ).first<{ count: number }>();
    expect(remaining?.count).toBe(1);
  });

  it("恒久的に失敗する共有が1バッチ分たまっていても、その後ろの正常な共有は掃除される", async () => {
    // 古い順に「必ず失敗する共有」を queryLimit 件、続いて正常な共有を数件置く。
    // 取得件数を queryLimit に固定していると、毎バッチ先頭の失敗共有ばかり
    // 取ってしまい正常な共有が永久に残る(issue #63 の再発)。
    const failingKeys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `poison-${i}`;
      const key = `files/${id}/file`;
      failingKeys.push(key);
      await insertShare({
        id,
        expiresAt: new Date(Date.now() - 120_000 + i).toISOString(),
      });
      await insertFile(id, key);
      await env.FILES_BUCKET.put(key, new Uint8Array([1]));
    }

    for (let i = 0; i < 3; i++) {
      await insertShare({
        id: `healthy-${i}`,
        expiresAt: new Date(Date.now() - 60_000 + i).toISOString(),
      });
    }

    const result = await cleanupExpiredShares(
      envWithFailingBucketDeleteFor(...failingKeys),
      { queryLimit: 3, maxBatches: 5 }
    );

    expect(result.failed).toBe(3);
    expect(result.processed).toBe(3);

    for (let i = 0; i < 3; i++) {
      expect(await shareExists(`poison-${i}`)).toBe(true);
      expect(await shareExists(`healthy-${i}`)).toBe(false);
    }
  });
});

describe("runScheduledCleanup", () => {
  it("期限切れ共有の掃除が想定外に throw しても、放置アップロードの掃除は実行される", async () => {
    // このシェア自体は有効期限内。stale upload の掃除対象だけを用意する。
    await insertShare({
      id: "share-scheduled",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const staleId = "upload-scheduled-stale";
    await insertUpload({
      id: staleId,
      shareId: "share-scheduled",
      storageKey: "files/share-scheduled/stale",
      uploadId: "r2-upload-scheduled-stale",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    // shares の期限切れ抽出クエリだけを throw させ、オーケストレータの
    // try/catch が働くことを確認する。
    const summary = await runScheduledCleanup(envWithFailingSharesExpiryQuery());

    expect(summary.expiredShares).toBeNull();
    expect(summary.staleUploads).not.toBeNull();
    expect(summary.staleUploads?.processed).toBe(1);
    expect(await uploadExists(staleId)).toBe(false);
  });

  it("正常時は両方の掃除結果を返す", async () => {
    await insertShare({
      id: "expired-scheduled",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const summary = await runScheduledCleanup(env);

    expect(summary.expiredShares?.processed).toBe(1);
    expect(summary.staleUploads?.processed).toBe(0);
    expect(await shareExists("expired-scheduled")).toBe(false);
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

  it("1件の削除失敗でその回の実行が止まらず、失敗件数が報告される", async () => {
    const shareId = "share-stale-fail";
    await insertShare({
      id: shareId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    for (let i = 0; i < 2; i++) {
      const id = `stale-fail-${i}`;
      await insertUpload({
        id,
        shareId,
        storageKey: `files/${shareId}/${id}`,
        uploadId: `r2-${id}`,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      await insertUploadPart(id);
    }

    const result = await cleanupStaleUploads(envWithFailingDbBatch(), {
      queryLimit: 1,
      maxBatches: 3,
    });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(2);

    // どちらのセッションもまだ残っている(次回実行で再試行される)。
    expect(await uploadExists("stale-fail-0")).toBe(true);
    expect(await uploadExists("stale-fail-1")).toBe(true);
  });
});
