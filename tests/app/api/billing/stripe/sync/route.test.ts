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
});

function daysFromNowUnix(days: number): number {
  return Math.floor((Date.now() + days * 24 * 60 * 60 * 1000) / 1000);
}

function subscription(
  status: string,
  priceId: string,
  periodEndUnix: number,
  cancelAtPeriodEnd = false
) {
  return {
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [{ current_period_end: periodEndUnix, price: { id: priceId } }],
    },
  };
}

async function postSync(cookie?: string) {
  const { POST } = await import("@/app/api/billing/stripe/sync/route");

  return POST(
    new Request("http://localhost/api/billing/stripe/sync", {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}) },
    })
  );
}

async function getAccount(accountId: string) {
  return env.DB.prepare(
    `SELECT plan, plan_expires_at, stripe_subscription_id FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{
      plan: string;
      plan_expires_at: string | null;
      stripe_subscription_id: string | null;
    }>();
}

describe("POST /api/billing/stripe/sync", () => {
  it("requires login", async () => {
    const response = await postSync();

    expect(response.status).toBe(401);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("returns the current plan without calling Stripe when the account never subscribed", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const response = await postSync(cookie);

    expect(response.status).toBe(200);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();

    const body = await readJson<{ plan: string; planExpiresAt: string | null }>(
      response
    );
    expect(body.plan).toBe("free");
    expect(body.planExpiresAt).toBeNull();
  });

  it("reflects an active subscription that the webhook never delivered", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      planExpiresAt: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_active",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    const periodEnd = daysFromNowUnix(30);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("active", env.STRIPE_PRICE_ID_STANDARD, periodEnd)
    );

    const response = await postSync(cookie);

    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_active");
    const body = await readJson<{
      plan: string;
      planExpiresAt: string | null;
      subscription: { state: string; currentPeriodEnd: string | null } | null;
    }>(response);
    expect(body.plan).toBe("standard");
    expect(body.planExpiresAt).toBe(
      new Date(periodEnd * 1000).toISOString()
    );
    expect(body.subscription).toEqual({
      state: "active",
      currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
    });

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
    expect(account?.plan_expires_at).toBe(
      new Date(periodEnd * 1000).toISOString()
    );
  });

  it("reports state 'canceling' for a subscription scheduled to end at period end", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: new Date(daysFromNowUnix(20) * 1000).toISOString(),
      stripeSubscriptionId: "sub_canceling",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    const periodEnd = daysFromNowUnix(20);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("active", env.STRIPE_PRICE_ID_STANDARD, periodEnd, true)
    );

    const response = await postSync(cookie);

    const body = await readJson<{
      plan: string;
      subscription: { state: string } | null;
    }>(response);
    expect(body.plan).toBe("standard");
    expect(body.subscription?.state).toBe("canceling");
  });

  it("returns subscription: null when the account never subscribed", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const response = await postSync(cookie);
    const body = await readJson<{ subscription: unknown }>(response);
    expect(body.subscription).toBeNull();
  });

  it("follows a price change (premium -> standard) reported by Stripe", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(daysFromNowUnix(10) * 1000).toISOString(),
      stripeSubscriptionId: "sub_downgraded",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    const periodEnd = daysFromNowUnix(30);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("active", env.STRIPE_PRICE_ID_STANDARD, periodEnd)
    );

    await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
  });

  it("does not update the account for an unrecognized price id (defensive)", async () => {
    const expiresAt = new Date(daysFromNowUnix(10) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: expiresAt,
      stripeSubscriptionId: "sub_unknown_price",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("active", "price_unrelated", daysFromNowUnix(30))
    );

    await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(expiresAt);
    expect(account?.stripe_subscription_id).toBe("sub_unknown_price");
  });

  it("does not move plan_expires_at backward when Stripe reports an earlier period end", async () => {
    const laterExpiry = new Date(
      daysFromNowUnix(40) * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: laterExpiry,
      stripeSubscriptionId: "sub_stale_read",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("active", env.STRIPE_PRICE_ID_STANDARD, daysFromNowUnix(30))
    );

    await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.plan_expires_at).toBe(laterExpiry);
  });

  it("immediately downgrades on a canceled subscription (mirrors the deleted webhook so a late webhook can't be lost)", async () => {
    const paidUntil = new Date(daysFromNowUnix(12) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: paidUntil,
      stripeSubscriptionId: "sub_canceled",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("canceled", env.STRIPE_PRICE_ID_STANDARD, daysFromNowUnix(-1))
    );

    const before = Date.now();
    const response = await postSync(cookie);
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    // plan_expires_at は「今」に更新され、元の期間末より手前になる。
    const newExpiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(newExpiry).toBeGreaterThanOrEqual(before - 1000);
    expect(newExpiry).toBeLessThanOrEqual(after + 1000);
    expect(newExpiry).toBeLessThan(new Date(paidUntil).getTime());

    // 実効プランは free に落ちている。
    const body = await readJson<{
      plan: string;
      subscription: unknown;
    }>(response);
    expect(body.plan).toBe("free");
    expect(body.subscription).toBeNull();
  });

  it("keeps a Bitcoin-prepaid future period when sync sees a dead (canceled) subscription", async () => {
    const btcPaidUntil = new Date(daysFromNowUnix(50) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: btcPaidUntil,
      stripeSubscriptionId: "sub_canceled_with_btc",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_sync_switch",
        btcPaidUntil,
        new Date().toISOString()
      )
      .run();
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("canceled", env.STRIPE_PRICE_ID_PREMIUM, daysFromNowUnix(-1))
    );

    const response = await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    // Bitcoin 前払いの期限は残る。実効プランも premium のまま。
    expect(account?.plan_expires_at).toBe(btcPaidUntil);

    const body = await readJson<{ plan: string }>(response);
    expect(body.plan).toBe("premium");
  });

  it("stops tracking a subscription that no longer exists on Stripe (404) without erroring, but does NOT downgrade plan/expiry (a 404 can be a mode/key mismatch, not a real cancellation; the signed deleted webhook handles real downgrades)", async () => {
    const paidUntil = new Date(daysFromNowUnix(5) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: paidUntil,
      stripeSubscriptionId: "sub_gone",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("No such subscription"), { statusCode: 404 })
    );

    const response = await postSync(cookie);

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 追跡ポインタだけ外れ、plan / plan_expires_at は保持される。
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan).toBe("standard");
    expect(account?.plan_expires_at).toBe(paidUntil);

    // 期限内なので実効プランはまだ standard(effectivePlan が期限で自動失効させる)。
    const body = await readJson<{ plan: string }>(response);
    expect(body.plan).toBe("standard");
  });

  it("does not fail (or change the DB) when the Stripe read errors transiently, and still surfaces the DB-backed plan", async () => {
    const expiresAt = new Date(daysFromNowUnix(10) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: expiresAt,
      stripeSubscriptionId: "sub_maybe_active",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("rate limited"), { statusCode: 429 })
    );

    const response = await postSync(cookie);

    expect(response.status).toBe(200);
    const body = await readJson<{
      success: boolean;
      plan: string;
      subscription: { state: string } | null;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.plan).toBe("standard");
    // 有効期限内なので、UI が管理ブロックを出せるよう暫定の要約を返す。
    expect(body.subscription?.state).toBe("active");

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_maybe_active");
    expect(account?.plan_expires_at).toBe(expiresAt);
  });

  it("returns subscription: null on a transient Stripe error when the paid period has already lapsed", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: new Date(daysFromNowUnix(-2) * 1000).toISOString(),
      stripeSubscriptionId: "sub_lapsed",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("stripe down"), { statusCode: 503 })
    );

    const response = await postSync(cookie);

    const body = await readJson<{
      success: boolean;
      plan: string;
      subscription: unknown;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.plan).toBe("free");
    expect(body.subscription).toBeNull();
  });

  it("leaves an intermediate (past_due) subscription tracked and untouched", async () => {
    const expiresAt = new Date(daysFromNowUnix(3) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: expiresAt,
      stripeSubscriptionId: "sub_past_due",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("past_due", env.STRIPE_PRICE_ID_STANDARD, daysFromNowUnix(3))
    );

    await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_past_due");
    expect(account?.plan).toBe("standard");
    expect(account?.plan_expires_at).toBe(expiresAt);
  });

  it("reflects a trialing subscription (free trial) as an active paid plan", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      planExpiresAt: null,
      stripeSubscriptionId: "sub_trialing",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    const periodEnd = daysFromNowUnix(14);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("trialing", env.STRIPE_PRICE_ID_PREMIUM, periodEnd)
    );

    const response = await postSync(cookie);

    const body = await readJson<{
      plan: string;
      subscription: { state: string } | null;
    }>(response);
    expect(body.plan).toBe("premium");
    expect(body.subscription?.state).toBe("active");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(
      new Date(periodEnd * 1000).toISOString()
    );
  });

  it("immediately downgrades on an 'unpaid' subscription (terminal dunning) just like 'canceled'", async () => {
    const paidUntil = new Date(daysFromNowUnix(12) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: paidUntil,
      stripeSubscriptionId: "sub_unpaid",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("unpaid", env.STRIPE_PRICE_ID_PREMIUM, daysFromNowUnix(12))
    );

    const before = Date.now();
    const response = await postSync(cookie);
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    const newExpiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(newExpiry).toBeGreaterThanOrEqual(before - 1000);
    expect(newExpiry).toBeLessThanOrEqual(after + 1000);
    expect(newExpiry).toBeLessThan(new Date(paidUntil).getTime());

    const body = await readJson<{ plan: string; subscription: unknown }>(
      response
    );
    expect(body.plan).toBe("free");
    expect(body.subscription).toBeNull();
  });

  it("immediately downgrades on an 'incomplete_expired' subscription (initial payment never confirmed)", async () => {
    const paidUntil = new Date(daysFromNowUnix(3) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: paidUntil,
      stripeSubscriptionId: "sub_incomplete_expired",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription(
        "incomplete_expired",
        env.STRIPE_PRICE_ID_STANDARD,
        daysFromNowUnix(-1)
      )
    );

    const before = Date.now();
    const response = await postSync(cookie);
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    const newExpiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(newExpiry).toBeGreaterThanOrEqual(before - 1000);
    expect(newExpiry).toBeLessThanOrEqual(after + 1000);
    expect(newExpiry).toBeLessThan(new Date(paidUntil).getTime());

    const body = await readJson<{ plan: string }>(response);
    expect(body.plan).toBe("free");
  });

  it("reports 'canceling' for a trialing subscription that is set to cancel at period end", async () => {
    const periodEnd = daysFromNowUnix(10);
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(periodEnd * 1000).toISOString(),
      stripeSubscriptionId: "sub_trial_canceling",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("trialing", env.STRIPE_PRICE_ID_PREMIUM, periodEnd, true)
    );

    const response = await postSync(cookie);

    const body = await readJson<{
      plan: string;
      subscription: { state: string } | null;
    }>(response);
    expect(body.plan).toBe("premium");
    expect(body.subscription?.state).toBe("canceling");
  });

  it("leaves an intermediate (incomplete) subscription tracked and untouched", async () => {
    const expiresAt = new Date(daysFromNowUnix(2) * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: expiresAt,
      stripeSubscriptionId: "sub_incomplete",
    });
    const cookie = await sessionCookieHeader(env, accountId);
    mockSubscriptionsRetrieve.mockResolvedValue(
      subscription("incomplete", env.STRIPE_PRICE_ID_STANDARD, daysFromNowUnix(2))
    );

    const response = await postSync(cookie);

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_incomplete");
    expect(account?.plan).toBe("standard");
    expect(account?.plan_expires_at).toBe(expiresAt);

    // active/trialing 以外なので、画面表示用の要約は null(契約フロー扱い)。
    const body = await readJson<{ subscription: unknown }>(response);
    expect(body.subscription).toBeNull();
  });
});
