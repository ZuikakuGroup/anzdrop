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

type AdminContactsBody = {
  success: boolean;
  contacts: Array<{
    id: string;
    name: string | null;
    email: string;
    subject: string;
  }>;
};

async function getContacts(query = ""): Promise<Response> {
  const { GET } = await import("@/app/api/admin/contacts/route");

  return GET(new Request(`http://localhost/api/admin/contacts${query}`));
}

async function insertContact(overrides: {
  id?: string;
  name?: string | null;
  email?: string;
  subject?: string;
  createdAt?: string;
  resolvedAt?: string | null;
}) {
  await env.DB.prepare(
    `
      INSERT INTO contacts (
        id, name, email, subject, message, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      overrides.id ?? crypto.randomUUID(),
      overrides.name ?? null,
      overrides.email ?? "user@example.com",
      overrides.subject ?? "some subject",
      "some message",
      overrides.createdAt ?? new Date().toISOString(),
      overrides.resolvedAt ?? null
    )
    .run();
}

describe("GET /api/admin/contacts", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertContact({});

    const response = await getContacts();

    expect(response.status).toBe(403);
  });

  it("defaults to unresolved contacts only", async () => {
    authorize();
    await insertContact({ id: "open-1", resolvedAt: null });
    await insertContact({
      id: "resolved-1",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getContacts();
    const body = (await response.json()) as AdminContactsBody;

    expect(response.status).toBe(200);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("open-1");
  });

  it("status=resolved returns only resolved contacts", async () => {
    authorize();
    await insertContact({ id: "open-1", resolvedAt: null });
    await insertContact({
      id: "resolved-1",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getContacts("?status=resolved");
    const body = (await response.json()) as AdminContactsBody;

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("resolved-1");
  });

  it("status=all returns both resolved and unresolved contacts", async () => {
    authorize();
    await insertContact({ id: "open-1", resolvedAt: null });
    await insertContact({
      id: "resolved-1",
      resolvedAt: new Date().toISOString(),
    });

    const response = await getContacts("?status=all");
    const body = (await response.json()) as AdminContactsBody;

    expect(body.contacts).toHaveLength(2);
  });

  it("orders contacts by created_at descending", async () => {
    authorize();
    const old = new Date(Date.now() - 60_000).toISOString();
    const recent = new Date().toISOString();

    await insertContact({ id: "old", createdAt: old });
    await insertContact({ id: "new", createdAt: recent });

    const response = await getContacts("?status=all");
    const body = (await response.json()) as AdminContactsBody;

    expect(body.contacts).toHaveLength(2);
    expect(body.contacts[0].id).toBe("new");
    expect(body.contacts[1].id).toBe("old");
  });
});
