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

vi.mock("@/lib/access", () => ({
  verifyAccessJwt: vi.fn(),
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
  vi.mocked(verifyAccessJwt).mockReset();
});

function authorize() {
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
}

async function suspendShare(shareId: string): Promise<Response> {
  const { POST } = await import("./route");

  return POST(
    new Request(`http://localhost/api/admin/shares/${shareId}/suspend`, {
      method: "POST",
    }),
    { params: Promise.resolve({ shareId }) }
  );
}

async function insertShare(id: string, suspendedAt: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO shares (id, created_at, expires_at, suspended_at) VALUES (?, ?, ?, ?)`
  )
    .bind(
      id,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      suspendedAt
    )
    .run();
}

async function getSuspendedAt(id: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT suspended_at FROM shares WHERE id = ?`
  )
    .bind(id)
    .first<{ suspended_at: string | null }>();

  return row?.suspended_at ?? null;
}

describe("POST /api/admin/shares/[shareId]/suspend", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertShare("share-1");

    const response = await suspendShare("share-1");

    expect(response.status).toBe(403);
    expect(await getSuspendedAt("share-1")).toBeNull();
  });

  it("sets suspended_at to a real timestamp on an unsuspended share", async () => {
    authorize();
    await insertShare("share-1");
    const before = Date.now();

    const response = await suspendShare("share-1");
    const after = Date.now();

    expect(response.status).toBe(200);

    const suspendedAt = await getSuspendedAt("share-1");
    expect(suspendedAt).not.toBeNull();
    const suspendedAtMs = new Date(suspendedAt!).getTime();
    expect(suspendedAtMs).toBeGreaterThanOrEqual(before);
    expect(suspendedAtMs).toBeLessThanOrEqual(after);
  });

  it("preserves the original suspended_at when suspending an already-suspended share again", async () => {
    authorize();
    const originalSuspendedAt = new Date(Date.now() - 60_000).toISOString();
    await insertShare("share-1", originalSuspendedAt);

    const response = await suspendShare("share-1");

    expect(response.status).toBe(200);
    expect(await getSuspendedAt("share-1")).toBe(originalSuspendedAt);
  });

  it("is a harmless no-op for a non-existent shareId", async () => {
    authorize();

    const response = await suspendShare("no-such-share");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
