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

type AdminReportsBody = {
  success: boolean;
  reports: Array<{
    id: string;
    shareId: string;
    category: string;
    share: {
      exists: boolean;
      expired: boolean;
      suspended: boolean;
      fileCount: number;
    };
  }>;
};

async function getReports(query = ""): Promise<Response> {
  const { GET } = await import("@/app/api/admin/reports/route");

  return GET(new Request(`http://localhost/api/admin/reports${query}`));
}

async function insertReport(overrides: {
  id?: string;
  shareId: string;
  category?: string;
  createdAt?: string;
  resolvedAt?: string | null;
}) {
  await env.DB.prepare(
    `
      INSERT INTO reports (
        id, share_id, reason, created_at, resolved_at, report_type, category
      ) VALUES (?, ?, ?, ?, ?, 'general', ?)
    `
  )
    .bind(
      overrides.id ?? crypto.randomUUID(),
      overrides.shareId,
      "some reason",
      overrides.createdAt ?? new Date().toISOString(),
      overrides.resolvedAt ?? null,
      overrides.category ?? "spam"
    )
    .run();
}

async function insertShare(overrides: {
  id: string;
  expiresAt?: string;
  suspendedAt?: string | null;
}) {
  await env.DB.prepare(
    `INSERT INTO shares (id, created_at, expires_at, suspended_at) VALUES (?, ?, ?, ?)`
  )
    .bind(
      overrides.id,
      new Date().toISOString(),
      overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      overrides.suspendedAt ?? null
    )
    .run();
}

async function insertFile(shareId: string) {
  await env.DB.prepare(
    `INSERT INTO files (id, share_id, storage_key, encrypted_file_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      shareId,
      `storage/${crypto.randomUUID()}`,
      "encrypted-name",
      1234,
      new Date().toISOString()
    )
    .run();
}

describe("GET /api/admin/reports", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertReport({ shareId: "share-1" });

    const response = await getReports();

    expect(response.status).toBe(403);
  });

  it("defaults to unresolved reports only", async () => {
    authorize();
    await insertReport({ shareId: "share-open", resolvedAt: null });
    await insertReport({
      shareId: "share-resolved",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getReports();
    const body = (await response.json()) as AdminReportsBody;

    expect(response.status).toBe(200);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].shareId).toBe("share-open");
  });

  it("status=resolved returns only resolved reports", async () => {
    authorize();
    await insertReport({ shareId: "share-open", resolvedAt: null });
    await insertReport({
      shareId: "share-resolved",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getReports("?status=resolved");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].shareId).toBe("share-resolved");
  });

  it("status=all returns both resolved and unresolved reports", async () => {
    authorize();
    await insertReport({ shareId: "share-open", resolvedAt: null });
    await insertReport({
      shareId: "share-resolved",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getReports("?status=all");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports).toHaveLength(2);
  });

  it("marks a report referencing a non-existent share as not existing", async () => {
    authorize();
    await insertReport({ shareId: "no-such-share" });

    const response = await getReports("?status=all");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports[0].share).toEqual({
      exists: false,
      expired: false,
      suspended: false,
      fileCount: 0,
    });
  });

  it("reports live share status (exists/expired/suspended/fileCount) for an active share with files", async () => {
    authorize();
    await insertShare({
      id: "share-active",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      suspendedAt: null,
    });
    await insertFile("share-active");
    await insertFile("share-active");
    await insertReport({ shareId: "share-active" });

    const response = await getReports("?status=all");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports[0].share).toEqual({
      exists: true,
      expired: false,
      suspended: false,
      fileCount: 2,
    });
  });

  it("marks an expired share as expired and a suspended share as suspended", async () => {
    authorize();
    await insertShare({
      id: "share-expired-suspended",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      suspendedAt: new Date().toISOString(),
    });
    await insertReport({ shareId: "share-expired-suspended" });

    const response = await getReports("?status=all");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports[0].share.exists).toBe(true);
    expect(body.reports[0].share.expired).toBe(true);
    expect(body.reports[0].share.suspended).toBe(true);
  });

  it("always sorts csam-category reports first, even when they were created later", async () => {
    authorize();
    const old = new Date(Date.now() - 60_000).toISOString();
    const recent = new Date().toISOString();

    await insertReport({
      id: "old-non-csam",
      shareId: "share-a",
      category: "spam",
      createdAt: old,
    });
    await insertReport({
      id: "new-csam",
      shareId: "share-b",
      category: "csam",
      createdAt: recent,
    });

    const response = await getReports("?status=all");
    const body = (await response.json()) as AdminReportsBody;

    expect(body.reports).toHaveLength(2);
    expect(body.reports[0].id).toBe("new-csam");
    expect(body.reports[1].id).toBe("old-non-csam");
  });
});
