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

async function resolveReport(reportId: string): Promise<Response> {
  const { POST } = await import("@/app/api/admin/reports/[reportId]/resolve/route");

  return POST(
    new Request(`http://localhost/api/admin/reports/${reportId}/resolve`, {
      method: "POST",
    }),
    { params: Promise.resolve({ reportId }) }
  );
}

async function insertReport(id: string, resolvedAt: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO reports (id, share_id, reason, created_at, resolved_at, report_type, category) VALUES (?, ?, ?, ?, ?, 'general', 'spam')`
  )
    .bind(id, "share-1", "some reason", new Date().toISOString(), resolvedAt)
    .run();
}

async function getResolvedAt(id: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT resolved_at FROM reports WHERE id = ?`
  )
    .bind(id)
    .first<{ resolved_at: string | null }>();

  return row?.resolved_at ?? null;
}

describe("POST /api/admin/reports/[reportId]/resolve", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertReport("report-1");

    const response = await resolveReport("report-1");

    expect(response.status).toBe(403);
    expect(await getResolvedAt("report-1")).toBeNull();
  });

  it("returns 404 for an unknown reportId", async () => {
    authorize();

    const response = await resolveReport("no-such-report");

    expect(response.status).toBe(404);
  });

  it("sets resolved_at to a real timestamp on success", async () => {
    authorize();
    await insertReport("report-1");
    const before = Date.now();

    const response = await resolveReport("report-1");
    const after = Date.now();

    expect(response.status).toBe(200);

    const resolvedAt = await getResolvedAt("report-1");
    expect(resolvedAt).not.toBeNull();
    const resolvedAtMs = new Date(resolvedAt!).getTime();
    expect(resolvedAtMs).toBeGreaterThanOrEqual(before);
    expect(resolvedAtMs).toBeLessThanOrEqual(after);
  });

  it("does not overwrite the original resolved_at when resolved a second time", async () => {
    authorize();
    await insertReport("report-1");

    await resolveReport("report-1");
    const firstResolvedAt = await getResolvedAt("report-1");

    // 同じタイムスタンプ文字列にならないよう、わずかに時間を進める。
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await resolveReport("report-1");
    expect(second.status).toBe(200);

    const secondResolvedAt = await getResolvedAt("report-1");
    expect(secondResolvedAt).toBe(firstResolvedAt);
  });
});
