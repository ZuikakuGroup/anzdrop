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

async function deleteReport(
  reportId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { DELETE } = await import("@/app/api/admin/reports/[reportId]/route");

  return DELETE(
    new Request(`http://localhost/api/admin/reports/${reportId}`, {
      method: "DELETE",
      headers,
    }),
    { params: Promise.resolve({ reportId }) }
  );
}

async function insertReport(id: string) {
  await env.DB.prepare(
    `INSERT INTO reports (id, share_id, reason, created_at, report_type, category) VALUES (?, ?, ?, ?, 'general', 'spam')`
  )
    .bind(id, "share-1", "some reason", new Date().toISOString())
    .run();
}

async function reportExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM reports WHERE id = ?`)
    .bind(id)
    .first();

  return row !== null;
}

describe("DELETE /api/admin/reports/[reportId]", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertReport("report-1");

    const response = await deleteReport("report-1");

    expect(response.status).toBe(403);
    expect(await reportExists("report-1")).toBe(true);
  });

  it("removes only the targeted report from the DB, leaving unrelated reports untouched", async () => {
    authorize();
    await insertReport("report-1");
    await insertReport("report-2");

    const response = await deleteReport("report-1");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(await reportExists("report-1")).toBe(false);
    // DELETEがWHERE句なしで全件消えるような回帰があればここで検出できる。
    expect(await reportExists("report-2")).toBe(true);
  });

  it("returns 403 and does not delete when the Origin header is a different site (CSRF)", async () => {
    authorize();
    await insertReport("report-1");

    const response = await deleteReport("report-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await reportExists("report-1")).toBe(true);
  });

  it("is idempotent: deleting a non-existent/already-deleted reportId still returns success", async () => {
    authorize();

    const response = await deleteReport("no-such-report");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
