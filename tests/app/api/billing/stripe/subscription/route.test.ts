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
  resetRateLimiters,
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
const mockSubscriptionsRetrieve = vi.fn();
const mockSubscriptionsCancel = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    customers = { create: mockCustomersCreate };
    subscriptions = {
      create: mockSubscriptionsCreate,
      retrieve: mockSubscriptionsRetrieve,
      cancel: mockSubscriptionsCancel,
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
  resetRateLimiters(env);
  mockCustomersCreate.mockReset();
  mockSubscriptionsCreate.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsCancel.mockReset();
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
  body: unknown = { plan: "premium" }
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

    const response = await postSubscription(cookie, { plan: "premium" });

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

    await postSubscription(cookie, { plan: "premium" });

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing_123" })
    );
  });

  it("rejects the not-yet-available standard plan (bypassing the purchase UI) with 400", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const response = await postSubscription(cookie, { plan: "standard" });

    expect(response.status).toBe(400);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("creates the subscription for the premium plan's price with card-only, default-incomplete settings", async () => {
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
        customer: "cus_existing",
        items: [{ price: env.STRIPE_PRICE_ID_PREMIUM }],
        payment_behavior: "default_incomplete",
        payment_settings: expect.objectContaining({
          payment_method_types: ["card"],
        }),
        expand: ["latest_invoice.confirmation_secret"],
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

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);

    // 決済が確定できる状態ではないため、DBへも反映しない。
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
  });

  it("returns 409 without creating a new subscription when the account already has an active subscription", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_already_active",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "active" });

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith(
      "sub_already_active"
    );
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();

    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);
  });

  it("returns 409 when the existing subscription is trialing", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_trialing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "trialing" });

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 without creating a new subscription when the existing one is past_due (dunning still retrying)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_past_due",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "past_due" });

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(409);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("cancels a terminal 'unpaid' subscription before creating a new one (kept consistent with the sync route's dead-status handling)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_unpaid",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "unpaid" });
    mockSubscriptionsCancel.mockResolvedValue({});
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_after_unpaid", "seti_after_unpaid")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_unpaid");
    expect(
      mockSubscriptionsCancel.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSubscriptionsCreate.mock.invocationCallOrder[0]);
  });

  it("cancels the abandoned incomplete subscription before creating a new one (so its old client_secret can no longer be used)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_abandoned",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "incomplete" });
    mockSubscriptionsCancel.mockResolvedValue({});
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_retry_new", "seti_retry_secret")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_abandoned");
    // キャンセルは新規作成より前に行われること。
    expect(
      mockSubscriptionsCancel.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSubscriptionsCreate.mock.invocationCallOrder[0]);
  });

  it("still creates a new subscription when cancelling the abandoned incomplete one returns 404 (already gone on Stripe)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_abandoned_gone",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "incomplete" });
    mockSubscriptionsCancel.mockRejectedValue(
      Object.assign(new Error("No such subscription"), {
        statusCode: 404,
        code: "resource_missing",
      })
    );
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_retry_new_2", "seti_retry_secret_2")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCreate).toHaveBeenCalled();
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_retry_new_2");
  });

  it("does not create a new subscription when cancelling the abandoned incomplete one fails transiently (not a 404)", async () => {
    // キャンセルが429・5xx・タイムアウト等で失敗した場合、旧Subscriptionの
    // client_secretは約23時間有効なまま残るため、新規作成へ進むと2本が
    // 同時に課金対象になりうる。この場合は新規作成せず失敗させる。
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_abandoned_transient",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "incomplete" });
    mockSubscriptionsCancel.mockRejectedValue(
      Object.assign(new Error("rate limited"), { statusCode: 429 })
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    // 旧Subscriptionの追跡は外さない(課金対象を見失わないため)。
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_abandoned_transient");
  });

  it("still creates a new subscription when cancel fails but the old subscription has since become terminal (retrieve/cancel race)", async () => {
    // retrieve が "incomplete" を返した後、cancel を呼ぶまでの間に Stripe の
    // 自動失効が走ると、subscription は削除されず "incomplete_expired" になる。
    // この状態への cancel は 404 ではなく 400 を返すが、もう課金対象では
    // ないため新規作成を妨げるべきではない。
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_race_expired",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce({ status: "incomplete" })
      .mockResolvedValueOnce({ status: "incomplete_expired" });
    mockSubscriptionsCancel.mockRejectedValue(
      Object.assign(new Error("subscription is in a terminal state"), {
        statusCode: 400,
      })
    );
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_after_race", "seti_after_race")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCreate).toHaveBeenCalled();
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_after_race");
  });

  it("does not create a new subscription when cancel fails and the old subscription is still billable", async () => {
    // cancel が一時障害で失敗し、retrieve し直しても依然 "incomplete"(課金対象に
    // なり得る)の場合は、新規作成へ進まず失敗させる。
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_still_incomplete",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "incomplete" });
    mockSubscriptionsCancel.mockRejectedValue(
      Object.assign(new Error("service unavailable"), { statusCode: 503 })
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_still_incomplete");
  });

  it("allows creating a new subscription when the previously registered subscription no longer exists on Stripe (404)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_gone",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("No such subscription"), {
        statusCode: 404,
        code: "resource_missing",
      })
    );
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_fresh", "seti_fresh_secret")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCreate).toHaveBeenCalled();
  });

  it("does not create a new subscription when checking the existing subscription fails transiently (not a 404)", async () => {
    // Stripe API側の一時的な障害(レート制限・タイムアウト等)を、404以外の
    // エラーとして再現する。この場合「既存Subscriptionは存在しない」と
    // 誤認してはならない(有効なSubscriptionを見落として二重作成しかねないため)。
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_maybe_active",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("rate limited"), { statusCode: 429 })
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("persists a newly created Stripe customer id even if the subsequent subscription creation fails (avoids an orphaned Customer on retry)", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockCustomersCreate.mockResolvedValue({ id: "cus_orphan_guard" });
    mockSubscriptionsCreate.mockRejectedValue(new Error("stripe down"));

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);

    const account = await getAccount(accountId);
    expect(account?.stripe_customer_id).toBe("cus_orphan_guard");
  });

  it("returns a generic 500 (without leaking internal error details) when the Stripe API call throws", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockRejectedValue(
      new Error("stripe unreachable: secret internal detail")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(500);
    const body = await readJson<{ success: boolean; error: string }>(
      response
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe("サーバー内部でエラーが発生しました");
    expect(body.error).not.toContain("stripe unreachable");
  });

  it("does not check any existing subscription when the account has a customer id but no subscription id", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_first", "seti_first_secret")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("creates a new subscription without a cancel call when the registered one is already 'canceled' (terminal)", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_canceled",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "canceled" });
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_after_canceled", "seti_after_canceled")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    // canceled は incomplete/unpaid と違い、明示的なキャンセルは不要。
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalled();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_after_canceled");
  });

  it("creates a new subscription without a cancel call when the registered one is 'incomplete_expired'", async () => {
    const { accountId } = await insertTestAccount(env, {
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_incomplete_expired",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue({
      status: "incomplete_expired",
    });
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_after_expired", "seti_after_expired")
    );

    const response = await postSubscription(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: env.STRIPE_PRICE_ID_PREMIUM }],
      })
    );
  });

  it("creates the Stripe customer with no personal data and links both ids for a premium checkout", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    mockCustomersCreate.mockResolvedValue({ id: "cus_consistent" });
    mockSubscriptionsCreate.mockResolvedValue(
      subscriptionWithClientSecret("sub_consistent", "seti_consistent")
    );

    await postSubscription(cookie, { plan: "premium" });

    // メールアドレス等の個人情報を Customer に渡さない(引数なしで作成)。
    expect(mockCustomersCreate).toHaveBeenCalledWith();

    const account = await getAccount(accountId);
    expect(account?.stripe_customer_id).toBe("cus_consistent");
    expect(account?.stripe_subscription_id).toBe("sub_consistent");
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_consistent" })
    );
  });

  describe("レート制限(GitHub issue #81)", () => {
    it("アカウントIDをキーに ACCOUNT_RATE_LIMITER を1リクエストにつき1回だけ消費する", async () => {
      const { accountId } = await insertTestAccount(env);
      const cookie = await sessionCookieHeader(env, accountId);
      mockCustomersCreate.mockResolvedValue({ id: "cus_rl" });
      mockSubscriptionsCreate.mockResolvedValue(
        subscriptionWithClientSecret("sub_rl", "pi_secret")
      );

      await postSubscription(cookie);

      expect(env.ACCOUNT_RATE_LIMITER.keys).toEqual([accountId]);
    });

    it("未ログインのリクエストは枠を消費しない(401 が先)", async () => {
      const response = await postSubscription();

      expect(response.status).toBe(401);
      expect(env.ACCOUNT_RATE_LIMITER.keys).toEqual([]);
    });

    it("枠を超えたら429を返し、Stripe 側に Customer も Subscription も作らない", async () => {
      const { accountId } = await insertTestAccount(env);
      const cookie = await sessionCookieHeader(env, accountId);
      env.ACCOUNT_RATE_LIMITER.denyKeyFrom(accountId, 1);

      const response = await postSubscription(cookie);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    });
  });
});
