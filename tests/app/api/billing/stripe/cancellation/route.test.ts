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
  sessionCookieHeader,
  readJson,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

const mockSubscriptionsRetrieve = vi.fn();
const mockSubscriptionsUpdate = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    subscriptions = {
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    };
    constructor() {}
  }

  return { default: MockStripe };
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
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsUpdate.mockReset();
});

function activeSubscription(cancelAtPeriodEnd: boolean) {
  const periodEnd = Math.floor(
    (Date.now() + 20 * 24 * 60 * 60 * 1000) / 1000
  );

  return {
    status: "active",
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [
        {
          current_period_end: periodEnd,
          price: { id: env.STRIPE_PRICE_ID_STANDARD },
        },
      ],
    },
  };
}

async function postCancellation(cookie?: string, body: unknown = { cancelAtPeriodEnd: true }) {
  const { POST } = await import(
    "@/app/api/billing/stripe/cancellation/route"
  );

  return POST(
    new Request("http://localhost/api/billing/stripe/cancellation", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

async function getSubscriptionId(accountId: string) {
  const row = await env.DB.prepare(
    `SELECT stripe_subscription_id FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{ stripe_subscription_id: string | null }>();

  return row?.stripe_subscription_id ?? null;
}

describe("POST /api/billing/stripe/cancellation", () => {
  it("requires login", async () => {
    const response = await postCancellation();

    expect(response.status).toBe(401);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is missing or malformed", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeSubscriptionId: "sub_1",
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const missing = await postCancellation(cookie, {});
    const wrongType = await postCancellation(cookie, {
      cancelAtPeriodEnd: "yes",
    });

    expect(missing.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when the account has no subscription", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const response = await postCancellation(cookie, { cancelAtPeriodEnd: true });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("schedules cancellation at period end and returns the 'canceling' summary", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      stripeSubscriptionId: "sub_active",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(activeSubscription(false));
    mockSubscriptionsUpdate.mockResolvedValue(activeSubscription(true));

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_active", {
      cancel_at_period_end: true,
    });

    const body = await readJson<{
      success: boolean;
      subscription: { state: string } | null;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.subscription?.state).toBe("canceling");

    // 期間末までプランはそのまま(即時ダウングレードしない)。
    const account = await env.DB.prepare(
      `SELECT plan FROM accounts WHERE id = ?`
    )
      .bind(accountId)
      .first<{ plan: string }>();
    expect(account?.plan).toBe("standard");
  });

  it("reactivates (undoes) a scheduled cancellation and returns the 'active' summary", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      stripeSubscriptionId: "sub_canceling",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(activeSubscription(true));
    mockSubscriptionsUpdate.mockResolvedValue(activeSubscription(false));

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: false,
    });

    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_canceling", {
      cancel_at_period_end: false,
    });
    const body = await readJson<{ subscription: { state: string } | null }>(
      response
    );
    expect(body.subscription?.state).toBe("active");
  });

  it("returns 409 when the subscription is not in an active state", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeSubscriptionId: "sub_incomplete",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({
      status: "incomplete",
      cancel_at_period_end: false,
      items: { data: [] },
    });

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("clears the pointer and returns 409 when the subscription no longer exists on Stripe (404)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeSubscriptionId: "sub_gone",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("No such subscription"), { statusCode: 404 })
    );

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
    expect(await getSubscriptionId(accountId)).toBeNull();
  });

  it("returns 500 and does not modify Stripe when the read fails transiently (not a 404)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeSubscriptionId: "sub_maybe",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("rate limited"), { statusCode: 429 })
    );

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(500);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
    expect(await getSubscriptionId(accountId)).toBe("sub_maybe");
  });

  it("allows scheduling cancellation for a trialing subscription", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      stripeSubscriptionId: "sub_trialing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    const trialing = { ...activeSubscription(false), status: "trialing" };
    mockSubscriptionsRetrieve.mockResolvedValue(trialing);
    mockSubscriptionsUpdate.mockResolvedValue({
      ...activeSubscription(true),
      status: "trialing",
    });

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_trialing", {
      cancel_at_period_end: true,
    });

    // trialing も active 扱いで要約が返ること(toSubscriptionSummary)。
    const body = await readJson<{
      success: boolean;
      subscription: { state: string } | null;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.subscription?.state).toBe("canceling");
  });

  it("returns 409 for a past_due subscription (dunning in progress is not a cancelable state here)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeSubscriptionId: "sub_past_due",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({
      status: "past_due",
      cancel_at_period_end: false,
      items: { data: [] },
    });

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns a generic 500 (and keeps the pointer) when the Stripe update call fails", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      stripeSubscriptionId: "sub_update_fails",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(activeSubscription(false));
    mockSubscriptionsUpdate.mockRejectedValue(
      new Error("stripe unreachable: internal detail")
    );

    const response = await postCancellation(cookie, {
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toBe("サーバー内部でエラーが発生しました");
    expect(body.error).not.toContain("stripe unreachable");
    expect(await getSubscriptionId(accountId)).toBe("sub_update_fails");
  });
});
