import { describe, expect, it, vi } from "vitest";
import { verifyShareOwnership } from "@/lib/share-auth";

type ShareRow = {
  created_at: string;
  expires_at: string;
  upload_token: string | null;
  suspended_at: string | null;
} | null;

function createFakeDb(row: ShareRow) {
  const bind = vi.fn(() => ({
    first: vi.fn(async () => row),
  }));
  const prepare = vi.fn(() => ({ bind }));

  return { db: { prepare } as unknown as CloudflareEnv["DB"], prepare, bind };
}

describe("verifyShareOwnership", () => {
  it("rejects without querying the database when uploadToken is missing", async () => {
    const { db, prepare } = createFakeDb(null);

    const result = await verifyShareOwnership(db, "share-1", undefined);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Missing uploadToken",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects without querying the database when uploadToken is an empty string", async () => {
    const { db, prepare } = createFakeDb(null);

    const result = await verifyShareOwnership(db, "share-1", "");

    expect(result.ok).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns 404 when the share does not exist", async () => {
    const { db } = createFakeDb(null);

    const result = await verifyShareOwnership(db, "missing-share", "token");

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Share not found",
    });
  });

  it("returns 403 when the share was never given an upload token", async () => {
    const { db } = createFakeDb({
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      upload_token: null,
      suspended_at: null,
    });

    const result = await verifyShareOwnership(db, "share-1", "some-token");

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Invalid uploadToken",
    });
  });

  it("returns 403 when the provided token does not match (does not leak whether the share exists)", async () => {
    const { db } = createFakeDb({
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      upload_token: "correct-token",
      suspended_at: null,
    });

    const result = await verifyShareOwnership(db, "share-1", "wrong-token");

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Invalid uploadToken",
    });
  });

  it("returns 410 for an expired share even with a correct token", async () => {
    const { db } = createFakeDb({
      created_at: "2020-01-01T00:00:00.000Z",
      expires_at: "2020-01-02T00:00:00.000Z", // 過去
      upload_token: "correct-token",
      suspended_at: null,
    });

    const result = await verifyShareOwnership(db, "share-1", "correct-token");

    expect(result).toEqual({
      ok: false,
      status: 410,
      error: "Share has expired",
    });
  });

  it("returns 403 for a suspended share even with a correct, unexpired token", async () => {
    const { db } = createFakeDb({
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      upload_token: "correct-token",
      suspended_at: "2026-02-01T00:00:00.000Z",
    });

    const result = await verifyShareOwnership(db, "share-1", "correct-token");

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Share is suspended",
    });
  });

  it("succeeds and returns the share's createdAt/expiresAt for a valid, unexpired, matching token", async () => {
    const { db, bind } = createFakeDb({
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      upload_token: "correct-token",
      suspended_at: null,
    });

    const result = await verifyShareOwnership(db, "share-1", "correct-token");

    expect(result).toEqual({
      ok: true,
      share: {
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    expect(bind).toHaveBeenCalledWith("share-1");
  });
});
