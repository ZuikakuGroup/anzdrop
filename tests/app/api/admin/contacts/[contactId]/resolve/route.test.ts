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

async function resolveContact(
  contactId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { POST } = await import(
    "@/app/api/admin/contacts/[contactId]/resolve/route"
  );

  return POST(
    new Request(`http://localhost/api/admin/contacts/${contactId}/resolve`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ contactId }) }
  );
}

async function insertContact(id: string, resolvedAt: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO contacts (id, email, subject, message, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      "user@example.com",
      "some subject",
      "some message",
      new Date().toISOString(),
      resolvedAt
    )
    .run();
}

async function getResolvedAt(id: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT resolved_at FROM contacts WHERE id = ?`
  )
    .bind(id)
    .first<{ resolved_at: string | null }>();

  return row?.resolved_at ?? null;
}

describe("POST /api/admin/contacts/[contactId]/resolve", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertContact("contact-1");

    const response = await resolveContact("contact-1");

    expect(response.status).toBe(403);
    expect(await getResolvedAt("contact-1")).toBeNull();
  });

  it("returns 404 for an unknown contactId", async () => {
    authorize();

    const response = await resolveContact("no-such-contact");

    expect(response.status).toBe(404);
  });

  it("sets resolved_at to a real timestamp on success", async () => {
    authorize();
    await insertContact("contact-1");
    const before = Date.now();

    const response = await resolveContact("contact-1");
    const after = Date.now();

    expect(response.status).toBe(200);

    const resolvedAt = await getResolvedAt("contact-1");
    expect(resolvedAt).not.toBeNull();
    const resolvedAtMs = new Date(resolvedAt!).getTime();
    expect(resolvedAtMs).toBeGreaterThanOrEqual(before);
    expect(resolvedAtMs).toBeLessThanOrEqual(after);
  });

  it("returns 403 and does not resolve when the Origin header is a different site (CSRF)", async () => {
    authorize();
    await insertContact("contact-1");

    const response = await resolveContact("contact-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await getResolvedAt("contact-1")).toBeNull();
  });

  it("does not overwrite the original resolved_at when resolved a second time", async () => {
    authorize();
    await insertContact("contact-1");

    await resolveContact("contact-1");
    const firstResolvedAt = await getResolvedAt("contact-1");

    // 同じタイムスタンプ文字列にならないよう、わずかに時間を進める。
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await resolveContact("contact-1");
    expect(second.status).toBe(200);

    const secondResolvedAt = await getResolvedAt("contact-1");
    expect(secondResolvedAt).toBe(firstResolvedAt);
  });
});
