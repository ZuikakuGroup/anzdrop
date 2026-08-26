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

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

const mockConstructEventAsync = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static createFetchHttpClient() {
      return {};
    }
    static createSubtleCryptoProvider() {
      return {};
    }
    webhooks = { constructEventAsync: mockConstructEventAsync };
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
  mockConstructEventAsync.mockReset();
  mockSubscriptionsRetrieve.mockReset();
});

async function postWebhook(body: string, signature = "valid-signature") {
  const { POST } = await import("@/app/api/billing/stripe/webhook/route");

  return POST(
    new Request("http://localhost/api/billing/stripe/webhook", {
      method: "POST",
      headers: signature ? { "stripe-signature": signature } : {},
      body,
    })
  );
}

function fakeEvent(id: string, type: string, data: unknown) {
  return { id, type, data: { object: data } };
}

async function getAccount(accountId: string) {
  return env.DB.prepare(
    `SELECT plan, plan_expires_at, stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{
      plan: string;
      plan_expires_at: string | null;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
    }>();
}

describe("POST /api/billing/stripe/webhook", () => {
  it("returns 400 when the stripe-signature header is missing", async () => {
    const response = await postWebhook("{}", "");

    expect(response.status).toBe(400);
    expect(mockConstructEventAsync).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEventAsync.mockRejectedValue(new Error("bad signature"));

    const response = await postWebhook("{}");

    expect(response.status).toBe(400);
  });

  it("processes checkout.session.completed and activates the account's plan", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_1", "checkout.session.completed", {
        client_reference_id: accountId,
        customer: "cus_new",
        subscription: "sub_new",
      })
    );
    mockSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ current_period_end: periodEndUnix }] },
    });

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("paid");
    expect(account?.stripe_customer_id).toBe("cus_new");
    expect(account?.stripe_subscription_id).toBe("sub_new");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not modify any account when checkout.session.completed is missing required ids", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_2", "checkout.session.completed", {
        client_reference_id: null,
        customer: "cus_x",
        subscription: "sub_x",
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("free");
  });

  it("processes customer.subscription.updated for an active subscription", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      stripeSubscriptionId: "sub_existing",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_3", "customer.subscription.updated", {
        id: "sub_existing",
        status: "active",
        items: { data: [{ current_period_end: periodEndUnix }] },
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("paid");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not update the account when customer.subscription.updated reports a non-active status", async () => {
    const originalExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_canceling",
    });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_4", "customer.subscription.updated", {
        id: "sub_canceling",
        status: "canceled",
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] },
      })
    );

    await postWebhook("{}");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("paid");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });

  it("processes customer.subscription.deleted by clearing the subscription id and expiring the plan immediately", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_deleted",
    });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_5", "customer.subscription.deleted", {
        id: "sub_deleted",
      })
    );

    const before = Date.now();
    const response = await postWebhook("{}");
    const after = Date.now();

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    const expiresAtMs = new Date(account!.plan_expires_at!).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before);
    expect(expiresAtMs).toBeLessThanOrEqual(after);
  });

  it("acknowledges unhandled event types without making any DB change", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_6", "customer.updated", { id: "cus_whatever" })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("free");
  });

  it("does not reprocess a duplicate event id (idempotency)", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const event = fakeEvent("evt_dup", "checkout.session.completed", {
      client_reference_id: accountId,
      customer: "cus_dup",
      subscription: "sub_dup",
    });
    mockConstructEventAsync.mockResolvedValue(event);
    mockSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ current_period_end: periodEndUnix }] },
    });

    const first = await postWebhook("{}");
    expect(first.status).toBe(200);
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(1);

    const second = await postWebhook("{}");
    expect(second.status).toBe(200);
    const secondBody = await readJson<{ note: string }>(second);
    expect(secondBody.note).toBe("duplicate event");
    // 2回目はイベント処理自体が走らないため、Stripe APIを再度叩かない。
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it("does not permanently mark an event as processed if handling it throws, so a Stripe retry can still succeed", async () => {
    // 実際に発生していたバグの再現テスト: 「処理済み」マークをswitch文の
    // 実行前に確定させていたため、途中で例外が起きるとイベントは
    // 「処理済み」のまま残り、Stripeが同じイベントIDで再送してきても
    // 二度とプランが反映されなくなっていた(顧客は決済済みなのに
    // アップグレードされない)。この回帰を防ぐテスト。
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const event = fakeEvent("evt_transient_failure", "checkout.session.completed", {
      client_reference_id: accountId,
      customer: "cus_retry",
      subscription: "sub_retry",
    });
    mockConstructEventAsync.mockResolvedValue(event);

    // 1回目: Stripe APIが一時的に失敗する状況を再現する。
    mockSubscriptionsRetrieve.mockRejectedValueOnce(
      new Error("temporary Stripe API failure")
    );

    const first = await postWebhook("{}");
    expect(first.status).toBe(500);

    const accountAfterFailure = await getAccount(accountId);
    expect(accountAfterFailure?.plan).toBe("free");

    // イベントが「処理済み」のまま残っていないこと。
    const eventRow = await env.DB.prepare(
      `SELECT id FROM stripe_events WHERE id = ?`
    )
      .bind(event.id)
      .first();
    expect(eventRow).toBeNull();

    // 2回目(Stripeからの再送を模したもの): 今度は成功する状況で、
    // 同じイベントIDでも正しく処理され、プランが反映されること。
    mockSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ current_period_end: periodEndUnix }] },
    });

    const retried = await postWebhook("{}");
    expect(retried.status).toBe(200);
    const retriedBody = await readJson<{ note?: string }>(retried);
    expect(retriedBody.note).toBeUndefined();

    const accountAfterRetry = await getAccount(accountId);
    expect(accountAfterRetry?.plan).toBe("paid");
    expect(accountAfterRetry?.stripe_customer_id).toBe("cus_retry");
  });
});
