import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import { diagnoseStorage } from "@/lib/storage/diagnostics";
let env: TestEnv, dispose: () => Promise<void>;
beforeAll(async () => { const handle = await createTestEnv(); env = handle.env; dispose = handle.dispose; });
afterAll(async () => dispose());
beforeEach(async () => clearAllTables(env));

async function seed() {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO shares (id,created_at,expires_at) VALUES ('active','2000','2099-01-01T00:00:00.000Z'), ('expired','2000','2000-01-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO files (id,share_id,storage_key,encrypted_file_name,size,created_at) VALUES
      ('a-file','active','a-object','encrypted-secret-name',7,'2000'), ('b-file','expired','missing-object','encrypted-other-name',3,'2000')`),
    env.DB.prepare(`INSERT INTO uploads (id,share_id,storage_key,upload_id,encrypted_file_name,created_at) VALUES
      ('tracked-upload','active','b-upload-object','synthetic-upload-id','encrypted-upload-name','2000-01-01T00:00:00.000Z')`),
  ]);
  await env.FILES_BUCKET.put("a-object", "synthetic-a");
  await env.FILES_BUCKET.put("b-upload-object", "synthetic-b");
  await env.FILES_BUCKET.put("c-orphan-object", "synthetic-c");
}

describe("read-only storage diagnosis", () => {
  it("reports counts and distinguishes pending completion from orphan suspects", async () => {
    await seed();
    const report = await diagnoseStorage(env);
    expect(report.summary).toMatchObject({ registeredFiles: 2, registeredPlaintextBytes: 10, expiredFiles: 1, expiredShares: 1, staleUploads: 1 });
    expect(report.files.missingFileIds).toEqual(["b-file"]);
    expect(report.objects.suspectedOrphanKeys).toEqual(["c-orphan-object"]);
    expect(report.objects.completedUploadKeys).toEqual(["b-upload-object"]);
    expect(report.objects.listedCiphertextBytes).toBe(33);
    expect(report.deletionFailureHistoryAvailable).toBe(false);
    expect(JSON.stringify(report)).not.toContain("encrypted-secret-name");
    expect(await env.FILES_BUCKET.head("c-orphan-object")).not.toBeNull();
  });
  it("paginates files and objects independently and omits expensive summary on continuation", async () => {
    await seed();
    const first = await diagnoseStorage(env, { limit: 1 });
    expect(first.files.nextAfterFileId).toBe("a-file"); expect(first.objects.nextCursor).not.toBeNull();
    const second = await diagnoseStorage(env, { limit: 1, afterFileId: first.files.nextAfterFileId!, objectCursor: first.objects.nextCursor! });
    expect(second.summary).toBeNull(); expect(second.files.missingFileIds).toEqual(["b-file"]);
    expect(second.files.nextAfterFileId).toBeNull();
    expect(second.objects.completedUploadKeys).toEqual(["b-upload-object"]);
    const third = await diagnoseStorage(env, { limit: 1, afterFileId: "b-file", objectCursor: second.objects.nextCursor! });
    expect(third.objects.suspectedOrphanKeys).toEqual(["c-orphan-object"]);
    expect(third.objects.nextCursor).toBeNull();
  });
  it("never reads object bodies, modifies D1 or deletes/aborts storage", async () => {
    await seed();
    const bucket = new Proxy(env.FILES_BUCKET, { get(target, key) {
      if (!["list", "head"].includes(String(key))) throw new Error("Unexpected R2 operation");
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const db = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return (sql: string) => {
        if (!sql.trimStart().startsWith("SELECT")) throw new Error("Unexpected D1 write");
        return env.DB.prepare(sql);
      };
      throw new Error("Unexpected D1 method");
    } });
    expect((await diagnoseStorage({ DB: db, FILES_BUCKET: bucket })).dryRun).toBe(true);
  });
  it("distinguishes HEAD failures from confirmed missing objects without exposing exception text", async () => {
    await seed();
    const bucket = new Proxy(env.FILES_BUCKET, { get(target, key) {
      if (key === "head") return async (storageKey: string) => {
        if (storageKey === "a-object") throw new Error("sensitive-synthetic-exception");
        return env.FILES_BUCKET.head(storageKey);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const report = await diagnoseStorage({ ...env, FILES_BUCKET: bucket });
    expect(report.files.headFailureFileIds).toEqual(["a-file"]);
    expect(report.files.missingFileIds).toEqual(["b-file"]);
    expect(JSON.stringify(report)).not.toContain("sensitive-synthetic-exception");
  });
  it.each([0, 41, 101, -1, 1.5, NaN])("rejects unbounded/invalid page size %s", async limit => {
    await expect(diagnoseStorage(env, { limit })).rejects.toThrow("Invalid diagnostic limit");
  });
  it("uses indexes for stale-upload ordering and storage-key lookups", async () => {
    for (const sql of [
      `SELECT id FROM uploads WHERE created_at <= '2099' ORDER BY created_at, id LIMIT 20`,
      `SELECT id FROM files WHERE storage_key = 'synthetic'`,
      `SELECT id FROM uploads WHERE storage_key = 'synthetic'`,
    ]) {
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
      const details = plan.results.map(row => row.detail).join(" ");
      expect(details).toMatch(/USING (?:COVERING )?INDEX idx_(?:uploads_created_at|files_storage_key|uploads_storage_key)/);
      expect(details).not.toContain("USE TEMP B-TREE");
    }
  });
});

it("flags duplicate file references without treating them as permission to delete", async () => {
  await seed();
  await env.DB.prepare(`INSERT INTO files (id,share_id,storage_key,encrypted_file_name,size,created_at) VALUES ('duplicate-file','expired','a-object','encrypted',7,'2000')`).run();
  const report = await diagnoseStorage(env);
  expect(report.objects.multipleFileReferenceKeys).toEqual(["a-object"]);
  expect(report.objects.suspectedOrphanKeys).not.toContain("a-object");
  expect(await env.FILES_BUCKET.head("a-object")).not.toBeNull();
});

it("measures removal of the stale-upload full scan and sort", async () => {
  const query = `EXPLAIN QUERY PLAN SELECT id FROM uploads WHERE created_at <= '2099' ORDER BY created_at, id LIMIT 20`;
  await env.DB.prepare(`DROP INDEX idx_uploads_created_at`).run();
  try {
    expect((await env.DB.prepare(`PRAGMA index_list(uploads)`).all<{ name: string }>()).results.some(row => row.name === "idx_uploads_created_at")).toBe(false);
    const before = (await env.DB.prepare(`${query} /* before index */`).all<{ detail: string }>()).results.map(row => row.detail).join(" ");
    expect(before).toContain("SCAN uploads"); expect(before).toContain("USE TEMP B-TREE");
  } finally { await env.DB.prepare(`CREATE INDEX idx_uploads_created_at ON uploads(created_at, id)`).run(); }
  const after = (await env.DB.prepare(`${query} /* after index */`).all<{ detail: string }>()).results.map(row => row.detail).join(" ");
  expect(after).toContain("USING"); expect(after).toContain("idx_uploads_created_at"); expect(after).not.toContain("USE TEMP B-TREE");
});

it("can scan only objects without repeating file HEADs", async () => {
  await seed();
  const bucket = new Proxy(env.FILES_BUCKET, { get(target, key) {
    if (key === "head") throw new Error("File HEAD must not run during object-only scan");
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await diagnoseStorage({ ...env, FILES_BUCKET: bucket }, { scan: "objects", summary: false });
  expect(result.files.scanned).toBe(false); expect(result.objects.scanned).toBe(true);
  expect(result.objects.suspectedOrphanKeys).toEqual(["c-orphan-object"]);
});
