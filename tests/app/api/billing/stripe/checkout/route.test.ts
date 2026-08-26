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

async function postCheckout(cookie?: string) {
  const { POST } = await import("@/app/api/billing/stripe/checkout/route");

  return POST(
    new Request("http://localhost/api/billing/stripe/checkout", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    })
  );
}

describe("POST /api/billing/stripe/checkout", () => {
  it("requires login", async () => {
    const response = await postCheckout();

    expect(response.status).toBe(401);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a subscription checkout session for the account's price and returns its url", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session-abc",
    });

    const response = await postCheckout(cookie);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      url: "https://checkout.stripe.com/session-abc",
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
        client_reference_id: accountId,
        subscription_data: { metadata: { accountId } },
        customer: undefined,
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

    await postCheckout(cookie);

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing_123" })
    );
  });

  it("returns 500 when Stripe does not return a checkout url", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockSessionsCreate.mockResolvedValue({ url: null });

    const response = await postCheckout(cookie);

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

    const response = await postCheckout(cookie);

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean; error: string }>(
      response
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
    expect(body.error).not.toContain("stripe unreachable");
  });
});
