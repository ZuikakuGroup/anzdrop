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

async function deleteContact(
  contactId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { DELETE } = await import("@/app/api/admin/contacts/[contactId]/route");

  return DELETE(
    new Request(`http://localhost/api/admin/contacts/${contactId}`, {
      method: "DELETE",
      headers,
    }),
    { params: Promise.resolve({ contactId }) }
  );
}

async function insertContact(id: string) {
  await env.DB.prepare(
    `INSERT INTO contacts (id, email, subject, message, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, "user@example.com", "some subject", "some message", new Date().toISOString())
    .run();
}

async function contactExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM contacts WHERE id = ?`)
    .bind(id)
    .first();

  return row !== null;
}

describe("DELETE /api/admin/contacts/[contactId]", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertContact("contact-1");

    const response = await deleteContact("contact-1");

    expect(response.status).toBe(403);
    expect(await contactExists("contact-1")).toBe(true);
  });

  it("removes only the targeted contact from the DB, leaving unrelated contacts untouched", async () => {
    authorize();
    await insertContact("contact-1");
    await insertContact("contact-2");

    const response = await deleteContact("contact-1");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(await contactExists("contact-1")).toBe(false);
    // DELETEがWHERE句なしで全件消えるような回帰があればここで検出できる。
    expect(await contactExists("contact-2")).toBe(true);
  });

  it("returns 403 and does not delete when the Origin header is a different site (CSRF)", async () => {
    authorize();
    await insertContact("contact-1");

    const response = await deleteContact("contact-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await contactExists("contact-1")).toBe(true);
  });

  it("is idempotent: deleting a non-existent/already-deleted contactId still returns success", async () => {
    authorize();

    const response = await deleteContact("no-such-contact");
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
