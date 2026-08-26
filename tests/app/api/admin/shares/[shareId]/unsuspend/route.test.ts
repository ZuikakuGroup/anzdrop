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

async function unsuspendShare(
  shareId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { POST } = await import("@/app/api/admin/shares/[shareId]/unsuspend/route");

  return POST(
    new Request(`http://localhost/api/admin/shares/${shareId}/unsuspend`, {
      method: "POST",
      headers,
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

describe("POST /api/admin/shares/[shareId]/unsuspend", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    const suspendedAt = new Date().toISOString();
    await insertShare("share-1", suspendedAt);

    const response = await unsuspendShare("share-1");

    expect(response.status).toBe(403);
    expect(await getSuspendedAt("share-1")).toBe(suspendedAt);
  });

  it("clears suspended_at back to null for a suspended share", async () => {
    authorize();
    await insertShare("share-1", new Date().toISOString());

    const response = await unsuspendShare("share-1");

    expect(response.status).toBe(200);
    expect(await getSuspendedAt("share-1")).toBeNull();
  });

  it("returns 403 and does not unsuspend when the Origin header is a different site (CSRF)", async () => {
    authorize();
    const suspendedAt = new Date().toISOString();
    await insertShare("share-1", suspendedAt);

    const response = await unsuspendShare("share-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await getSuspendedAt("share-1")).toBe(suspendedAt);
  });

  it("is a harmless no-op for an already-unsuspended share", async () => {
    authorize();
    await insertShare("share-1", null);

    const response = await unsuspendShare("share-1");

    expect(response.status).toBe(200);
    expect(await getSuspendedAt("share-1")).toBeNull();
  });

  it("is a harmless no-op for a non-existent shareId", async () => {
    authorize();

    const response = await unsuspendShare("no-such-share");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
