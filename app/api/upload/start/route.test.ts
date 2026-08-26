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
  insertTestAccount,
  sessionCookieHeader,
  stubTurnstileSuccess,
  stubTurnstileFailure,
  readJson,
  type TestEnv,
} from "@/test/env";
import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import { RETENTION_DAYS } from "@/lib/retention";

type StartResponseBody = {
  success: boolean;
  shareId: string;
  uploadToken: string;
  uploadSessionId: string;
};

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postStart(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");

  return POST(
    new Request("http://localhost/api/upload/start", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

async function getShare(shareId: string) {
  return env.DB.prepare(
    `SELECT id, created_at, expires_at, upload_token, preview_allowed FROM shares WHERE id = ?`
  )
    .bind(shareId)
    .first<{
      id: string;
      created_at: string;
      expires_at: string;
      upload_token: string | null;
      preview_allowed: number;
    }>();
}

describe("POST /api/upload/start", () => {
  it("returns 400 when encryptedFileName is missing", async () => {
    const response = await postStart({
      fileSize: 1024,
      retention: "7d",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when retention is missing or invalid", async () => {
    const missing = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 1024,
      turnstileToken: "tok",
    });
    const invalid = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 1024,
      retention: "5d",
      turnstileToken: "tok",
    });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("returns 400 when fileSize is missing or non-positive", async () => {
    const missing = await postStart({
      encryptedFileName: "file.enc",
      retention: "7d",
      turnstileToken: "tok",
    });
    const zero = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 0,
      retention: "7d",
      turnstileToken: "tok",
    });

    expect(missing.status).toBe(400);
    expect(zero.status).toBe(400);
  });

  it("returns 400 when the free plan's max file size is exceeded", async () => {
    const response = await postStart({
      encryptedFileName: "file.enc",
      fileSize: MAX_FILE_SIZE_BYTES + 1,
      retention: "7d",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);

    const { results: shares } = await env.DB.prepare(
      `SELECT id FROM shares`
    ).all();
    expect(shares).toHaveLength(0);
  });

  it("allows a file exactly at the free plan's max size (boundary, not just over-the-limit)", async () => {
    stubTurnstileSuccess();

    const response = await postStart({
      encryptedFileName: "file.enc",
      fileSize: MAX_FILE_SIZE_BYTES,
      retention: "7d",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
  });

  it("returns 403 when a free-plan uploader requests 30d retention", async () => {
    const response = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 1024,
      retention: "30d",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 when Turnstile verification fails for a new share", async () => {
    stubTurnstileFailure();

    const response = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 1024,
      retention: "7d",
      turnstileToken: "bad-token",
    });

    expect(response.status).toBe(403);

    const { results: shares } = await env.DB.prepare(
      `SELECT id FROM shares`
    ).all();
    expect(shares).toHaveLength(0);
  });

  it("creates a new share for an anonymous (free-plan) uploader with preview_allowed=0", async () => {
    stubTurnstileSuccess();

    const before = Date.now();
    const response = await postStart({
      encryptedFileName: "file.enc",
      fileSize: 1024,
      retention: "7d",
      turnstileToken: "tok",
    });
    const after = Date.now();

    expect(response.status).toBe(200);
    const body = await readJson<StartResponseBody>(response);
    expect(body.success).toBe(true);
    expect(typeof body.shareId).toBe("string");
    expect(typeof body.uploadToken).toBe("string");
    expect(typeof body.uploadSessionId).toBe("string");

    const share = await getShare(body.shareId);
    expect(share).toBeTruthy();
    expect(share?.upload_token).toBe(body.uploadToken);
    expect(share?.preview_allowed).toBe(0);

    const expectedMs = RETENTION_DAYS["7d"] * 24 * 60 * 60 * 1000;
    const expiresAtMs = new Date(share!.expires_at).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + expectedMs);
    expect(expiresAtMs).toBeLessThanOrEqual(after + expectedMs);

    const upload = await env.DB.prepare(
      `SELECT share_id, encrypted_file_name, max_downloads FROM uploads WHERE id = ?`
    )
      .bind(body.uploadSessionId)
      .first<{
        share_id: string;
        encrypted_file_name: string;
        max_downloads: number | null;
      }>();
    expect(upload?.share_id).toBe(body.shareId);
    expect(upload?.encrypted_file_name).toBe("file.enc");
    expect(upload?.max_downloads).toBeNull();
  });

  it("creates a new share for a paid uploader with preview_allowed=1", async () => {
    stubTurnstileSuccess();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: future,
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const response = await postStart(
      {
        encryptedFileName: "file.enc",
        fileSize: 1024,
        retention: "30d",
        turnstileToken: "tok",
      },
      { cookie }
    );

    expect(response.status).toBe(200);
    const body = await readJson<StartResponseBody>(response);

    const share = await getShare(body.shareId);
    expect(share?.preview_allowed).toBe(1);
  });

  it("allows joining an existing share via shareId+uploadToken without a Turnstile token, and keeps the original preview_allowed", async () => {
    stubTurnstileSuccess();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: future,
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const created = await postStart(
      {
        encryptedFileName: "first.enc",
        fileSize: 1024,
        retention: "7d",
        turnstileToken: "tok",
      },
      { cookie }
    );
    const createdBody = await readJson<StartResponseBody>(created);
    expect((await getShare(createdBody.shareId))?.preview_allowed).toBe(1);

    // 相乗りは匿名(free扱い)で、Turnstileトークンを渡さない。
    vi.unstubAllGlobals();

    const joined = await postStart({
      encryptedFileName: "second.enc",
      fileSize: 2048,
      retention: "7d",
      shareId: createdBody.shareId,
      uploadToken: createdBody.uploadToken,
    });

    expect(joined.status).toBe(200);
    const joinedBody = await readJson<StartResponseBody>(joined);
    expect(joinedBody.shareId).toBe(createdBody.shareId);
    expect(joinedBody.uploadToken).toBe(createdBody.uploadToken);

    // 相乗り時はpreview_allowedを再判定しない(作成時の値=paid由来の1のまま)。
    const share = await getShare(createdBody.shareId);
    expect(share?.preview_allowed).toBe(1);

    const { results: uploads } = await env.DB.prepare(
      `SELECT id, encrypted_file_name FROM uploads WHERE share_id = ? ORDER BY encrypted_file_name`
    )
      .bind(createdBody.shareId)
      .all<{ id: string; encrypted_file_name: string }>();
    expect(uploads).toHaveLength(2);
    expect(uploads.map((u) => u.encrypted_file_name)).toEqual([
      "first.enc",
      "second.enc",
    ]);
  });

  it("returns 403 when joining an existing share with a wrong uploadToken", async () => {
    stubTurnstileSuccess();

    const created = await postStart({
      encryptedFileName: "first.enc",
      fileSize: 1024,
      retention: "7d",
      turnstileToken: "tok",
    });
    const createdBody = await readJson<StartResponseBody>(created);

    const joined = await postStart({
      encryptedFileName: "second.enc",
      fileSize: 1024,
      retention: "7d",
      shareId: createdBody.shareId,
      uploadToken: "wrong-token",
    });

    expect(joined.status).toBe(403);

    const { results: uploads } = await env.DB.prepare(
      `SELECT id FROM uploads WHERE share_id = ?`
    )
      .bind(createdBody.shareId)
      .all();
    expect(uploads).toHaveLength(1);
  });
});
