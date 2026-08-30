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
  insertTestAccount,
  readJson,
  type TestEnv,
} from "@/test/env";
import { verifyAccessJwt } from "@/lib/access";
import { INDEFINITE_PLAN_EXPIRES_AT } from "@/lib/plan";
import type { AdminAccountInfo } from "@/app/api/admin/accounts/[accountId]/schema";

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

async function getRoute(accountId: string): Promise<Response> {
  const { GET } = await import(
    "@/app/api/admin/accounts/[accountId]/route"
  );

  return GET(
    new Request(`http://localhost/api/admin/accounts/${accountId}`),
    { params: Promise.resolve({ accountId }) }
  );
}

async function postRoute(
  accountId: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { POST } = await import(
    "@/app/api/admin/accounts/[accountId]/route"
  );

  return POST(
    new Request(`http://localhost/api/admin/accounts/${accountId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ accountId }) }
  );
}

async function deleteRoute(
  accountId: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { DELETE } = await import(
    "@/app/api/admin/accounts/[accountId]/route"
  );

  return DELETE(
    new Request(`http://localhost/api/admin/accounts/${accountId}`, {
      method: "DELETE",
      headers,
    }),
    { params: Promise.resolve({ accountId }) }
  );
}

async function readAccountRow(accountId: string): Promise<{
  plan: string;
  plan_expires_at: string | null;
  stripe_subscription_id: string | null;
} | null> {
  return env.DB.prepare(
    `SELECT plan, plan_expires_at, stripe_subscription_id FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first();
}

const FUTURE_ISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 60_000).toISOString();

describe("GET /api/admin/accounts/[accountId]", () => {
  it("returns 403 when the caller is not an authorized admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertTestAccount(env, { id: "acct-1" });

    const response = await getRoute("acct-1");

    expect(response.status).toBe(403);
  });

  it("reports exists: false for an unknown account id", async () => {
    authorize();

    const response = await getRoute("no-such-account");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account.exists).toBe(false);
    expect(body.account.effectivePlan).toBe("free");
  });

  it("returns stored plan, effective plan and expiry for a paid account", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-premium",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
    });

    const response = await getRoute("acct-premium");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(body.account).toMatchObject({
      exists: true,
      storedPlan: "premium",
      effectivePlan: "premium",
      planExpiresAt: FUTURE_ISO,
      indefinite: false,
      hasStripeSubscription: false,
    });
  });

  it("marks an expired paid account's effective plan as free", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-expired",
      plan: "premium",
      planExpiresAt: PAST_ISO,
    });

    const response = await getRoute("acct-expired");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(body.account.storedPlan).toBe("premium");
    expect(body.account.effectivePlan).toBe("free");
  });

  it("reports hasStripeSubscription when the account is linked to a subscription", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-stripe",
      plan: "standard",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_123",
    });

    const response = await getRoute("acct-stripe");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(body.account.hasStripeSubscription).toBe(true);
  });
});

describe("POST /api/admin/accounts/[accountId]", () => {
  it("returns 403 and does not change the plan when the caller is not an admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: null,
    });

    expect(response.status).toBe(403);
    expect((await readAccountRow("acct-1"))?.plan).toBe("free");
  });

  it("returns 403 and does not change the plan on a cross-origin request (CSRF)", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute(
      "acct-1",
      { plan: "premium", expiresAt: null },
      { Origin: "https://evil.example" }
    );

    expect(response.status).toBe(403);
    expect((await readAccountRow("acct-1"))?.plan).toBe("free");
  });

  it("returns 404 for an unknown account id", async () => {
    authorize();

    const response = await postRoute("no-such-account", {
      plan: "premium",
      expiresAt: null,
    });

    expect(response.status).toBe(404);
  });

  it("rejects an invalid plan value with 400", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "free",
      expiresAt: null,
    });

    expect(response.status).toBe(400);
    expect((await readAccountRow("acct-1"))?.plan).toBe("free");
  });

  it("rejects a past expiresAt with 400", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: PAST_ISO,
    });

    expect(response.status).toBe(400);
    expect((await readAccountRow("acct-1"))?.plan).toBe("free");
  });

  it("rejects a non-date expiresAt string with 400", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: "not-a-date",
    });

    expect(response.status).toBe(400);
  });

  it("grants a standard plan with a future end date", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "standard",
      expiresAt: FUTURE_ISO,
    });
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account).toMatchObject({
      storedPlan: "standard",
      effectivePlan: "standard",
      planExpiresAt: FUTURE_ISO,
      indefinite: false,
    });

    const row = await readAccountRow("acct-1");
    expect(row?.plan).toBe("standard");
    expect(row?.plan_expires_at).toBe(FUTURE_ISO);
  });

  it("grants an indefinite premium plan by storing the sentinel expiry", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: null,
    });
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(body.account.effectivePlan).toBe("premium");
    expect(body.account.indefinite).toBe(true);

    const row = await readAccountRow("acct-1");
    expect(row?.plan).toBe("premium");
    expect(row?.plan_expires_at).toBe(INDEFINITE_PLAN_EXPIRES_AT);
  });

  it("normalizes a non-ISO date string to a full toISOString() value before storing", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    // 日付のみ・オフセット付きなど、Date.parse は通るが toISOString() 形式では
    // ない文字列を渡しても、DB には固定フォーマットで入る必要がある
    // (Stripe Webhook / sync の辞書順比較ガードが崩れないように)。
    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: "2099-01-01",
    });

    expect(response.status).toBe(200);

    const stored = (await readAccountRow("acct-1"))?.plan_expires_at;
    expect(stored).toBe(new Date("2099-01-01").toISOString());
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("succeeds on a same-origin request (Origin header matches)", async () => {
    authorize();
    await insertTestAccount(env, { id: "acct-1", plan: "free" });

    const response = await postRoute(
      "acct-1",
      { plan: "premium", expiresAt: null },
      { Origin: "http://localhost" }
    );

    expect(response.status).toBe(200);
    expect((await readAccountRow("acct-1"))?.plan).toBe("premium");
  });

  it("grants the plan without blocking when the account has a Stripe subscription", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "free",
      stripeSubscriptionId: "sub_active",
    });

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: null,
    });
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account.hasStripeSubscription).toBe(true);
    expect(body.account.effectivePlan).toBe("premium");
    expect((await readAccountRow("acct-1"))?.stripe_subscription_id).toBe(
      "sub_active"
    );
  });

  it("applies the admin's explicit plan choice even when it is lower than the current plan", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
    });

    const response = await postRoute("acct-1", {
      plan: "standard",
      expiresAt: FUTURE_ISO,
    });

    expect(response.status).toBe(200);
    expect((await readAccountRow("acct-1"))?.plan).toBe("standard");
  });
});

describe("DELETE /api/admin/accounts/[accountId]", () => {
  it("returns 403 and keeps the plan when the caller is not an admin", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
    });

    const response = await deleteRoute("acct-1");

    expect(response.status).toBe(403);
    expect((await readAccountRow("acct-1"))?.plan).toBe("premium");
  });

  it("returns 403 on a cross-origin request (CSRF)", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
    });

    const response = await deleteRoute("acct-1", {
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect((await readAccountRow("acct-1"))?.plan).toBe("premium");
  });

  it("returns 404 for an unknown account id", async () => {
    authorize();

    const response = await deleteRoute("no-such-account");

    expect(response.status).toBe(404);
  });

  it("clears an indefinitely granted plan back to free", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: INDEFINITE_PLAN_EXPIRES_AT,
    });

    const response = await deleteRoute("acct-1");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account.indefinite).toBe(false);
    expect(body.account.effectivePlan).toBe("free");

    const row = await readAccountRow("acct-1");
    expect(row?.plan).toBe("free");
    expect(row?.plan_expires_at).toBeNull();
  });

  it("resets the plan to free and clears the expiry, keeping stripe_subscription_id", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_keepme",
    });

    const response = await deleteRoute("acct-1");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account).toMatchObject({
      storedPlan: "free",
      effectivePlan: "free",
      planExpiresAt: null,
    });

    const row = await readAccountRow("acct-1");
    expect(row?.plan).toBe("free");
    expect(row?.plan_expires_at).toBeNull();
    expect(row?.stripe_subscription_id).toBe("sub_keepme");
  });
});
