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

const mockSubscriptionsRetrieve = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    subscriptions = { retrieve: mockSubscriptionsRetrieve };
    constructor() {}
  }

  return { default: MockStripe };
});

function subscriptionStatus(status: string) {
  return { status };
}

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
  mockSubscriptionsRetrieve.mockReset();
  // 明示的に上書きしないテスト向けのデフォルト。stripe_subscription_id が
  // 設定されているアカウントは「生きた契約」を指しているものとして扱う。
  mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("active"));
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

  it("reports hasStripeSubscription: true when the linked subscription is live on Stripe (active)", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-stripe",
      plan: "standard",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_123",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("active"));

    const response = await getRoute("acct-stripe");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
    expect(body.account.hasStripeSubscription).toBe(true);
  });

  it("reports hasStripeSubscription: true for a trialing or past_due subscription (still manageable)", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-trialing",
      plan: "standard",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_trialing",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("trialing"));
    expect(
      (await readJson<{ account: AdminAccountInfo }>(await getRoute("acct-trialing")))
        .account.hasStripeSubscription
    ).toBe(true);

    await insertTestAccount(env, {
      id: "acct-past-due",
      plan: "standard",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_past_due",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("past_due"));
    expect(
      (await readJson<{ account: AdminAccountInfo }>(await getRoute("acct-past-due")))
        .account.hasStripeSubscription
    ).toBe(true);
  });

  it.each(["incomplete", "incomplete_expired", "canceled", "unpaid"])(
    "reports hasStripeSubscription: false when the linked subscription is %s on Stripe (stale pointer left by an abandoned checkout)",
    async (status) => {
      authorize();
      await insertTestAccount(env, {
        id: "acct-stale",
        plan: "free",
        planExpiresAt: null,
        stripeSubscriptionId: "sub_stale",
      });
      mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus(status));

      const response = await getRoute("acct-stale");
      const body = await readJson<{ account: AdminAccountInfo }>(response);

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_stale");
      expect(body.account.hasStripeSubscription).toBe(false);
    }
  );

  it("does not call Stripe when the account has no stripe_subscription_id", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-no-sub",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
    });

    const response = await getRoute("acct-no-sub");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(body.account.hasStripeSubscription).toBe(false);
  });

  it.each([
    ["a 404 (mode/key mismatch or a real deletion)", 404],
    ["a transient error (rate limit / outage)", 429],
  ])(
    "conservatively reports hasStripeSubscription: true when the Stripe retrieve fails with %s",
    async (_label, statusCode) => {
      authorize();
      await insertTestAccount(env, {
        id: "acct-stripe-down",
        plan: "standard",
        planExpiresAt: FUTURE_ISO,
        stripeSubscriptionId: "sub_unknown",
      });
      mockSubscriptionsRetrieve.mockRejectedValue(
        Object.assign(new Error("stripe error"), { statusCode })
      );

      const response = await getRoute("acct-stripe-down");
      const body = await readJson<{ account: AdminAccountInfo }>(response);

      expect(response.status).toBe(200);
      expect(body.account.hasStripeSubscription).toBe(true);
    }
  );

  it("does not clear plan / expiry / pointer while resolving the live Stripe status (GET stays read-only)", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-readonly",
      plan: "standard",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_dead",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscriptionStatus("incomplete_expired")
    );

    await getRoute("acct-readonly");

    const row = await readAccountRow("acct-readonly");
    expect(row?.plan).toBe("standard");
    expect(row?.plan_expires_at).toBe(FUTURE_ISO);
    expect(row?.stripe_subscription_id).toBe("sub_dead");
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

  it("grants the plan without blocking when the account has a live Stripe subscription", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "free",
      stripeSubscriptionId: "sub_active",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("active"));

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

  it("returns hasStripeSubscription: false after granting when the pointer is a stale (incomplete_expired) subscription", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "free",
      stripeSubscriptionId: "sub_abandoned",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscriptionStatus("incomplete_expired")
    );

    const response = await postRoute("acct-1", {
      plan: "premium",
      expiresAt: null,
    });
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    // 警告は出ない(ゴミポインタなので sync / Webhook が上書きすることはない)。
    expect(body.account.hasStripeSubscription).toBe(false);
    expect(body.account.effectivePlan).toBe("premium");
    // ポインタ自体は GET と同じく触らない。
    expect((await readAccountRow("acct-1"))?.stripe_subscription_id).toBe(
      "sub_abandoned"
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

  it("still reports hasStripeSubscription: true after reverting to free when the card contract is live (the revert can be undone by the next sync)", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "premium",
      planExpiresAt: FUTURE_ISO,
      stripeSubscriptionId: "sub_live",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("active"));

    const response = await deleteRoute("acct-1");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account.hasStripeSubscription).toBe(true);
  });

  it("reports hasStripeSubscription: false after reverting to free when the pointer is a stale (canceled) subscription", async () => {
    authorize();
    await insertTestAccount(env, {
      id: "acct-1",
      plan: "free",
      stripeSubscriptionId: "sub_stale",
    });
    mockSubscriptionsRetrieve.mockResolvedValue(subscriptionStatus("canceled"));

    const response = await deleteRoute("acct-1");
    const body = await readJson<{ account: AdminAccountInfo }>(response);

    expect(response.status).toBe(200);
    expect(body.account.hasStripeSubscription).toBe(false);
  });
});
