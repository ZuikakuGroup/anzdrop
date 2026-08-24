import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredShares, cleanupStaleUploads } from "./cleanup";

type FakeEnvConfig = {
  expiredShares?: { id: string }[];
  filesByShare?: Record<string, { storage_key: string }[]>;
  uploadsByShare?: Record<
    string,
    { id: string; storage_key: string; upload_id: string }[]
  >;
  staleUploads?: { id: string; storage_key: string; upload_id: string }[];
  abortShouldThrow?: boolean;
};

function createFakeEnv(config: FakeEnvConfig) {
  const bucketDelete = vi.fn(async () => {});
  const abort = vi.fn(async () => {
    if (config.abortShouldThrow) {
      throw new Error("already completed");
    }
  });
  const resumeMultipartUpload = vi.fn(() => ({ abort }));
  const batch = vi.fn(async () => []);
  let currentSql = "";

  const bind = vi.fn((...args: unknown[]) => {
    const sql = currentSql;

    return {
      all: async () => {
        if (sql.includes("FROM shares WHERE expires_at")) {
          return { results: config.expiredShares ?? [] };
        }
        if (sql.includes("FROM files WHERE share_id")) {
          const shareId = args[0] as string;
          return { results: config.filesByShare?.[shareId] ?? [] };
        }
        if (sql.includes("FROM uploads WHERE share_id")) {
          const shareId = args[0] as string;
          return { results: config.uploadsByShare?.[shareId] ?? [] };
        }
        if (sql.includes("FROM uploads WHERE created_at")) {
          return { results: config.staleUploads ?? [] };
        }
        return { results: [] };
      },
    };
  });

  const prepare = vi.fn((sql: string) => {
    currentSql = sql;
    return { bind };
  });

  const env = {
    DB: { prepare, batch } as unknown as CloudflareEnv["DB"],
    FILES_BUCKET: {
      delete: bucketDelete,
      resumeMultipartUpload,
    } as unknown as CloudflareEnv["FILES_BUCKET"],
  } as unknown as CloudflareEnv;

  return { env, bucketDelete, abort, resumeMultipartUpload, batch, prepare, bind };
}

describe("cleanupExpiredShares", () => {
  it("does nothing when there are no expired shares", async () => {
    const { env, batch, bucketDelete, resumeMultipartUpload } =
      createFakeEnv({ expiredShares: [] });

    await cleanupExpiredShares(env);

    expect(batch).not.toHaveBeenCalled();
    expect(bucketDelete).not.toHaveBeenCalled();
    expect(resumeMultipartUpload).not.toHaveBeenCalled();
  });

  it("deletes R2 objects for completed files and aborts incomplete multipart uploads", async () => {
    const { env, batch, bucketDelete, resumeMultipartUpload, abort } =
      createFakeEnv({
        expiredShares: [{ id: "share-1" }],
        filesByShare: {
          "share-1": [{ storage_key: "file-key-1" }],
        },
        uploadsByShare: {
          "share-1": [
            {
              id: "upload-1",
              storage_key: "upload-key-1",
              upload_id: "r2-upload-id-1",
            },
          ],
        },
      });

    await cleanupExpiredShares(env);

    expect(bucketDelete).toHaveBeenCalledWith("file-key-1");
    expect(resumeMultipartUpload).toHaveBeenCalledWith(
      "upload-key-1",
      "r2-upload-id-1"
    );
    expect(abort).toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("still deletes DB rows even when aborting the multipart upload fails", async () => {
    const { env, batch } = createFakeEnv({
      expiredShares: [{ id: "share-1" }],
      uploadsByShare: {
        "share-1": [
          {
            id: "upload-1",
            storage_key: "upload-key-1",
            upload_id: "r2-upload-id-1",
          },
        ],
      },
      abortShouldThrow: true,
    });

    await expect(cleanupExpiredShares(env)).resolves.toBeUndefined();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("processes each expired share independently", async () => {
    const { env, batch } = createFakeEnv({
      expiredShares: [{ id: "share-1" }, { id: "share-2" }],
    });

    await cleanupExpiredShares(env);

    expect(batch).toHaveBeenCalledTimes(2);
  });
});

describe("cleanupStaleUploads", () => {
  it("does nothing when there are no stale upload sessions", async () => {
    const { env, batch, resumeMultipartUpload } = createFakeEnv({
      staleUploads: [],
    });

    await cleanupStaleUploads(env);

    expect(batch).not.toHaveBeenCalled();
    expect(resumeMultipartUpload).not.toHaveBeenCalled();
  });

  it("aborts stale multipart uploads and deletes their DB rows, independently of share expiry", async () => {
    const { env, batch, resumeMultipartUpload, abort } = createFakeEnv({
      staleUploads: [
        {
          id: "upload-1",
          storage_key: "upload-key-1",
          upload_id: "r2-upload-id-1",
        },
      ],
    });

    await cleanupStaleUploads(env);

    expect(resumeMultipartUpload).toHaveBeenCalledWith(
      "upload-key-1",
      "r2-upload-id-1"
    );
    expect(abort).toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("does not throw when aborting an already-finished upload fails", async () => {
    const { env, batch } = createFakeEnv({
      staleUploads: [
        {
          id: "upload-1",
          storage_key: "upload-key-1",
          upload_id: "r2-upload-id-1",
        },
      ],
      abortShouldThrow: true,
    });

    await expect(cleanupStaleUploads(env)).resolves.toBeUndefined();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("queries using a threshold roughly 24 hours in the past", async () => {
    const { env, bind } = createFakeEnv({ staleUploads: [] });

    const before = Date.now() - 24 * 60 * 60 * 1000;
    await cleanupStaleUploads(env);
    const after = Date.now() - 24 * 60 * 60 * 1000;

    const staleQueryArgs = bind.mock.calls.at(-1);
    expect(staleQueryArgs).toBeDefined();

    const threshold = new Date(staleQueryArgs![0] as string).getTime();

    expect(threshold).toBeGreaterThanOrEqual(before - 1000);
    expect(threshold).toBeLessThanOrEqual(after + 1000);
  });
});
