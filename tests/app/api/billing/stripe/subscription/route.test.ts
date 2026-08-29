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

const mockCustomersCreate = vi.fn();
const mockSubscriptionsCreate = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    customers = { create: mockCustomersCreate };
    subscriptions = { create: mockSubscriptionsCreate };
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
  mockCustomersCreate.mockReset();
  mockSubscriptionsCreate.mockReset();
});

function subscriptionWithClientSecret(
  id: string,
  clientSecret: string | null
) {
  return {
    id,
    latest_invoice: {
      confirmation_secret: clientSecret
        ? { client_secret: clientSecret }
        : null,
    },
  };
}

async function postSubscription(
  cookie?: string,
  body: unknown = { plan: "standard" }
) {
  const { POST } = await import(
    "@/app/api/billing/stripe/subscription/route"
  );

  return POST(
    new Request("http://localhost/api/billing/stripe/subscription", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

async function getAccount(accountId: string) {
  return env.DB.prepare(
    `SELECT stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
    }>();
}

describe("POST /api/billing/stripe/subscription", () => {
  it("requires login", async () => {
    const response = await postSubscription();

    expect(response.status).toBe(401);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when plan is missing or invalid", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const missing = await postSubscription(cookie, {});
    const invalid = await postSubscription(cookie, { plan: "free" });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("creates a new Stripe customer (with no personal data) when the account has none yet", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_new", "seti_new_secret")
    );

    const response = await postSubscription(cookie, { plan: "standard" });

    expect(response.status).toBe(200);
    expect(mockCustomersCreate).toHaveBeenCalledWith();

    const body = await readJson<{ success: boolean; clientSecret?: string }>(
      response
    );
    expect(body).toEqual({ success: true, clientSecret: "seti_new_secret" });

    const account = await getAccount(accountId);
    expect(account?.stripe_customer_id).toBe("cus_new");
    expect(account?.stripe_subscription_id).toBe("sub_new");
  });

  it("reuses the account's existing Stripe customer id when present", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing_123",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_xyz", "seti_xyz_secret")
    );

    await postSubscription(cookie, { plan: "standard" });

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing_123" })
    );
  });

  it("creates the subscription for the standard plan's price with card-only, default-incomplete settings", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_standard", "seti_standard_secret")
    );

    await postSubscription(cookie, { plan: "standard" });

    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing",
        items: [{ price: env.STRIPE_PRICE_ID_STANDARD }],
        payment_behavior: "default_incomplete",
        payment_settings: expect.objectContaining({
          payment_method_types: ["card"],
        }),
        expand: ["latest_invoice.confirmation_secret"],
        metadata: { accountId, plan: "standard" },
      })
    );
  });

  it("creates the subscription for the premium plan's price", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_premium", "seti_premium_secret")
    );

    await postSubscription(cookie, { plan: "premium" });

    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: env.STRIPE_PRICE_ID_PREMIUM }],
        metadata: { accountId, plan: "premium" },
      })
    );
  });

  it("returns 500 when Stripe does not return a payment intent client secret", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_no_secret", null)
    );

    const response = await postSubscription(cookie, { plan: "standard" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);

    // 決済が確定できる状態ではないため、DBへも反映しない。
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
  });

  it("returns a generic 500 (without leaking internal error details) when the Stripe API call throws", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockRejectedValue(
      new Error("stripe unreachable: secret internal detail")
    );

    const response = await postSubscription(cookie, { plan: "standard" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean; error: string }>(
      response
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe("サーバー内部でエラーが発生しました");
    expect(body.error).not.toContain("stripe unreachable");
  });
});
