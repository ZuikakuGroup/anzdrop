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

const mockSessionsCreate = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    checkout = { sessions: { create: mockSessionsCreate } };
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
  mockSessionsCreate.mockReset();
});

async function postCheckout(
  cookie?: string,
  body: unknown = { plan: "standard" }
) {
  const { POST } = await import("@/app/api/billing/stripe/checkout/route");

  return POST(
    new Request("http://localhost/api/billing/stripe/checkout", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/billing/stripe/checkout", () => {
  it("requires login", async () => {
    const response = await postCheckout();

    expect(response.status).toBe(401);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when plan is missing or invalid", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const missing = await postCheckout(cookie, {});
    const invalid = await postCheckout(cookie, { plan: "free" });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a subscription checkout session for the standard plan's price and returns its url", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session-abc",
    });

    const response = await postCheckout(cookie, { plan: "standard" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      url: "https://checkout.stripe.com/session-abc",
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [
          { price: env.STRIPE_PRICE_ID_STANDARD, quantity: 1 },
        ],
        client_reference_id: accountId,
        subscription_data: {
          metadata: { accountId, plan: "standard" },
        },
        customer: undefined,
        success_url: "http://localhost/mypage/billing?checkout=success",
        cancel_url: "http://localhost/mypage/billing?checkout=cancelled",
      })
    );
  });

  it("creates a subscription checkout session for the premium plan's price", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session-premium",
    });

    await postCheckout(cookie, { plan: "premium" });

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          { price: env.STRIPE_PRICE_ID_PREMIUM, quantity: 1 },
        ],
        subscription_data: {
          metadata: { accountId, plan: "premium" },
        },
      })
    );
  });

  it("reuses the account's existing Stripe customer id when present", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing_123",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session-xyz",
    });

    await postCheckout(cookie, { plan: "standard" });

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing_123" })
    );
  });

  it("returns 500 when Stripe does not return a checkout url", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({ url: null });

    const response = await postCheckout(cookie, { plan: "standard" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);
  });

  it("returns a generic 500 (without leaking internal error details) when the Stripe API call throws", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockRejectedValue(
      new Error("stripe unreachable: secret internal detail")
    );

    const response = await postCheckout(cookie, { plan: "standard" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean; error: string }>(
      response
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe("サーバー内部でエラーが発生しました");
    expect(body.error).not.toContain("stripe unreachable");
  });
});
