import {
  afterAll,
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
  readJson,
  resetRateLimiters,
  type TestEnv,
} from "@/test/env";

type DownloadResponseBody = {
  share: { previewAllowed: boolean };
  files: { id: string; isOneTime: boolean }[];
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
  resetRateLimiters(env);
});

type ShareOverrides = {
  id?: string;
  createdAt?: string;
  expiresAt?: string;
  uploadToken?: string | null;
  wrappedKey?: string | null;
  keySalt?: string | null;
  suspendedAt?: string | null;
  previewAllowed?: number;
};

async function insertShare(overrides: ShareOverrides = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO shares (
        id, created_at, expires_at, upload_token, wrapped_key, key_salt, suspended_at, preview_allowed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      overrides.createdAt ?? new Date().toISOString(),
      overrides.expiresAt ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      overrides.uploadToken ?? null,
      overrides.wrappedKey ?? null,
      overrides.keySalt ?? null,
      overrides.suspendedAt ?? null,
      overrides.previewAllowed ?? 0
    )
    .run();

  return id;
}

type FileOverrides = {
  id?: string;
  storageKey?: string;
  encryptedFileName?: string;
  size?: number;
  maxDownloads?: number | null;
  downloadCount?: number;
};

async function insertFile(
  shareId: string,
  overrides: FileOverrides = {}
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO files (
        id, share_id, storage_key, encrypted_file_name, size, max_downloads, download_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      shareId,
      overrides.storageKey ?? crypto.randomUUID(),
      overrides.encryptedFileName ?? "file.enc",
      overrides.size ?? 1024,
      overrides.maxDownloads ?? null,
      overrides.downloadCount ?? 0,
      new Date().toISOString()
    )
    .run();

  return id;
}

async function getDownload(shareId: string) {
  const { GET } = await import("@/app/api/download/[shareId]/route");

  return GET(new Request(`http://localhost/api/download/${shareId}`), {
    params: Promise.resolve({ shareId }),
  });
}

describe("GET /api/download/[shareId]", () => {
  it("returns 404 for an unknown shareId", async () => {
    const response = await getDownload("no-such-share");

    expect(response.status).toBe(404);
  });

  it("returns 410 for an expired share", async () => {
    const shareId = await insertShare({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const response = await getDownload(shareId);

    expect(response.status).toBe(410);
  });

  it("returns 403 for a suspended share", async () => {
    const shareId = await insertShare({
      suspendedAt: new Date().toISOString(),
    });

    const response = await getDownload(shareId);

    expect(response.status).toBe(403);
  });

  it("returns previewAllowed=true for a share created by a paid uploader (preview_allowed=1)", async () => {
    const shareId = await insertShare({ previewAllowed: 1 });

    const response = await getDownload(shareId);
    expect(response.status).toBe(200);
    const body = await readJson<DownloadResponseBody>(response);
    expect(body.share.previewAllowed).toBe(true);
  });

  it("returns previewAllowed=false for a share created by a free uploader (preview_allowed=0)", async () => {
    const shareId = await insertShare({ previewAllowed: 0 });

    const response = await getDownload(shareId);
    expect(response.status).toBe(200);
    const body = await readJson<DownloadResponseBody>(response);
    expect(body.share.previewAllowed).toBe(false);
  });

  it("excludes files that have already hit their max_downloads limit, and reports isOneTime correctly", async () => {
    const shareId = await insertShare();
    const exhaustedId = await insertFile(shareId, {
      encryptedFileName: "exhausted.enc",
      maxDownloads: 1,
      downloadCount: 1,
    });
    const unlimitedId = await insertFile(shareId, {
      encryptedFileName: "unlimited.enc",
      maxDownloads: null,
      downloadCount: 5,
    });
    const oneTimeNotYetUsedId = await insertFile(shareId, {
      encryptedFileName: "one-time-available.enc",
      maxDownloads: 1,
      downloadCount: 0,
    });

    const response = await getDownload(shareId);
    expect(response.status).toBe(200);
    const body = await readJson<DownloadResponseBody>(response);

    const returnedIds = body.files.map((f) => f.id);
    expect(returnedIds).not.toContain(exhaustedId);
    expect(returnedIds).toContain(unlimitedId);
    expect(returnedIds).toContain(oneTimeNotYetUsedId);
    expect(body.files).toHaveLength(2);

    const unlimited = body.files.find((f) => f.id === unlimitedId);
    expect(unlimited?.isOneTime).toBe(false);

    const oneTime = body.files.find((f) => f.id === oneTimeNotYetUsedId);
    expect(oneTime?.isOneTime).toBe(true);
  });

  describe("レート制限(GitHub issue #81)", () => {
    it("shareId をキーに SHARE_RATE_LIMITER を1リクエストにつき1回だけ消費する", async () => {
      const shareId = await insertShare();

      await getDownload(shareId);

      expect(env.SHARE_RATE_LIMITER.keys).toEqual([shareId]);
      // ダウンロード本体用の枠は消費しない(別バインディング)。
      expect(env.FILE_RATE_LIMITER.keys).toEqual([]);
    });

    it("枠を超えたら429を返し、共有の中身は一切返さない", async () => {
      const shareId = await insertShare({ wrappedKey: "wrapped", keySalt: "salt" });
      await insertFile(shareId);
      env.SHARE_RATE_LIMITER.denyKeyFrom(shareId, 1);

      const response = await getDownload(shareId);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");

      const body = await readJson<Record<string, unknown>>(response);

      expect(body.success).toBe(false);
      expect(body.share).toBeUndefined();
      expect(body.files).toBeUndefined();
    });

    it("存在しない共有でも枠を消費し、存在の有無で応答が変わらない", async () => {
      await getDownload("no-such-share");

      expect(env.SHARE_RATE_LIMITER.keys).toEqual(["no-such-share"]);
    });

    it("超過した共有だけが止まり、別の共有は影響を受けない", async () => {
      const blockedShareId = await insertShare();
      const otherShareId = await insertShare();

      // 本物のバインディングと同じく、枠はキーごとに独立している。
      env.SHARE_RATE_LIMITER.denyKeyFrom(blockedShareId, 1);

      expect((await getDownload(blockedShareId)).status).toBe(429);
      expect((await getDownload(otherShareId)).status).toBe(200);
    });

    it("バインディングが落ちていてもダウンロードは止めない(フェイルオープン)", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const shareId = await insertShare();
      env.SHARE_RATE_LIMITER.failNext();

      const response = await getDownload(shareId);

      expect(response.status).toBe(200);
      consoleError.mockRestore();
    });
  });
});
