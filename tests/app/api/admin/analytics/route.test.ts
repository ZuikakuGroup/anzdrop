import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestEnv, clearAllTables, readJson, type TestEnv } from "@/test/env";
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

async function getAnalytics(query: string) {
  const { GET } = await import("@/app/api/admin/analytics/route");

  return GET(new Request(`http://localhost/api/admin/analytics?${query}`));
}

describe("GET /api/admin/analytics", () => {
  it("returns 403 when not authenticated as admin", async () => {
    const response = await getAnalytics("view=overview");

    expect(response.status).toBe(403);
  });

  it("returns 400 for an unknown view", async () => {
    authorize();

    const response = await getAnalytics("view=nonexistent");

    expect(response.status).toBe(400);
  });

  it.each([
    "from=2026-02-30&to=2026-03-01",
    "from=2026-1-01&to=2026-01-31",
    "from=2026-02-01&to=2026-01-31",
  ])("rejects an invalid date range before generating a report: %s", async (range) => {
    authorize();

    const response = await getAnalytics(`view=funnel&${range}`);

    expect(response.status).toBe(400);
  });

  it("returns the overview report for view=overview", async () => {
    authorize();

    const response = await getAnalytics("view=overview");
    const body = await readJson<{ success: boolean; view: string; data: unknown }>(
      response
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.view).toBe("overview");
    expect(body.data).toHaveProperty("today");
  });

  it("returns the funnel report for view=funnel with the requested date range", async () => {
    authorize();

    const response = await getAnalytics(
      "view=funnel&from=2026-01-01&to=2026-01-31"
    );
    const body = await readJson<{
      success: boolean;
      from: string;
      to: string;
      data: { steps: unknown[] };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.from).toBe("2026-01-01");
    expect(body.to).toBe("2026-01-31");
    expect(Array.isArray(body.data.steps)).toBe(true);
  });

  it("returns the reliability, acquisition, retention, and recipient-growth reports", async () => {
    authorize();

    for (const view of [
      "reliability",
      "acquisition",
      "retention",
      "recipient-growth",
    ]) {
      const response = await getAnalytics(`view=${view}`);

      expect(response.status).toBe(200);
    }
  });
});
