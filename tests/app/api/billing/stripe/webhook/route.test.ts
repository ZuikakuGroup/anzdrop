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
  // フォールバック経路が「衝突チェック」でstripe.subscriptions.retrieve()を
  // 呼ぶケースのデフォルト。個々のテストで衝突を検証したい場合は上書きする。
  mockSubscriptionsRetrieve.mockResolvedValue({ status: "canceled" });
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

function subscriptionWithPrice(priceId: string, periodEndUnix: number) {
  return {
    items: {
      data: [{ current_period_end: periodEndUnix, price: { id: priceId } }],
    },
  };
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

  it("processes customer.subscription.updated for an active subscription (initial activation and renewals alike)", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_existing",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_3", "customer.subscription.updated", {
        id: "sub_existing",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not update any account when no row has a matching stripe_subscription_id", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_no_match", "customer.subscription.updated", {
        id: "sub_never_registered",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("free");
  });

  it("recovers via metadata.accountId when accounts.stripe_subscription_id was overwritten by a later subscription attempt", async () => {
    // 同じアカウントが2回"POST /api/billing/stripe/subscription"を呼ぶと
    // (2つのタブで契約を開始する等)、accounts.stripe_subscription_idは
    // 後に呼ばれた方のSubscription IDで上書きされる。その状態で先に
    // 作成した(古い)方のSubscriptionで実際に支払いが確定した場合でも、
    // metadata.accountIdを手がかりにプランが反映されることを確認する。
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_stale",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    // 別のSubscription作成(2つ目のタブ等を想定)がaccountsの
    // stripe_subscription_idを上書きした状況を再現する。
    await env.DB.prepare(
      `UPDATE accounts SET stripe_subscription_id = ? WHERE id = ?`
    )
      .bind("sub_newer_attempt", accountId)
      .run();

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_fallback", "customer.subscription.updated", {
        id: "sub_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    // 衝突チェックのため、上書き対象になる「別の」Subscriptionを実際に
    // Stripeへ問い合わせていること(デフォルトモックはactive/trialingでは
    // ないため、衝突なしと判定されフォールバックが適用される)。
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith(
      "sub_newer_attempt"
    );
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.stripe_subscription_id).toBe("sub_stale");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("skips the metadata.accountId fallback when accounts.stripe_subscription_id points to a different subscription that is still active on Stripe", async () => {
    // 有効期限だけを見ると新しい方(このイベント)を採用してよさそうに
    // 見えても、現在紐づいている別のSubscriptionがStripe上でまだ
    // active/trialingなら上書きしない(2つのSubscriptionが両方
    // 課金対象のまま残ってしまうのを防ぐ)。
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(
        Date.now() + 10 * 24 * 60 * 60 * 1000
      ).toISOString(),
      stripeSubscriptionId: "sub_other_still_active",
    });
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "active" });

    // 現在の有効期限より後になる(=有効期限チェックだけなら通ってしまう)、
    // 別のSubscriptionから届いたイベント。
    const laterPeriodEndUnix =
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_conflict", "customer.subscription.updated", {
        id: "sub_new_attempt",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          laterPeriodEndUnix
        ),
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith(
      "sub_other_still_active"
    );

    const account = await getAccount(accountId);
    // stripe_subscription_id・有効期限のどちらも上書きされていないこと。
    expect(account?.stripe_subscription_id).toBe("sub_other_still_active");
    expect(new Date(account!.plan_expires_at!).getTime()).toBeLessThan(
      laterPeriodEndUnix * 1000
    );
  });

  it("fails the whole webhook (and keeps the account unchanged) when checking the conflicting subscription fails transiently (not a 404)", async () => {
    // 衝突チェックのstripe.subscriptions.retrieve()がレート制限等で一時的に
    // 失敗した場合、「衝突なし」と誤認して上書きしてはならない。イベント
    // 全体を失敗させ(withApiHandlerの汎用500)、Stripeの再送に賭ける。
    const originalExpiry = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_other_unknown_state",
    });
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error("rate limited"), { statusCode: 429 })
    );

    const laterPeriodEndUnix =
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
    const event = fakeEvent(
      "evt_conflict_check_failure",
      "customer.subscription.updated",
      {
        id: "sub_new_attempt",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          laterPeriodEndUnix
        ),
      }
    );
    mockConstructEventAsync.mockResolvedValue(event);

    const response = await postWebhook("{}");

    expect(response.status).toBe(500);

    // アカウントは一切変更されていないこと。
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_other_unknown_state");
    expect(account?.plan_expires_at).toBe(originalExpiry);

    // 「処理済み」マークも取り消され、Stripeの再送を受け付けられること。
    const eventRow = await env.DB.prepare(
      `SELECT id FROM stripe_events WHERE id = ?`
    )
      .bind(event.id)
      .first();
    expect(eventRow).toBeNull();
  });

  it("skips the metadata.accountId fallback when it would move plan_expires_at backward", async () => {
    // フォールバック自体が、既に別の有効なSubscriptionでより新しい有効期限が
    // 設定済みの状態を、古いイベントの情報で後退させてしまわないことを確認する。
    const laterExpiry = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: laterExpiry,
      stripeSubscriptionId: "sub_newer_valid",
    });
    // 現在の有効期限より前になる、古いSubscriptionからのイベント。
    const earlierPeriodEndUnix =
      Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_stale_fallback", "customer.subscription.updated", {
        id: "sub_older_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          earlierPeriodEndUnix
        ),
      })
    );

    const response = await postWebhook("{}");

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 何も上書きされていないこと(有効期限も、紐づくSubscription IDも)。
    expect(account?.plan_expires_at).toBe(laterExpiry);
    expect(account?.stripe_subscription_id).toBe("sub_newer_valid");
  });

  it("downgrades from premium to standard when the subscription's price changes to the standard price", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      stripeSubscriptionId: "sub_downgrade",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_downgrade", "customer.subscription.updated", {
        id: "sub_downgrade",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_STANDARD, periodEndUnix),
      })
    );

    await postWebhook("{}");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
  });

  it("does not update the account when customer.subscription.updated reports an unrecognized price id (defensive)", async () => {
    const originalExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_unknown_price",
    });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_unknown_price_update", "customer.subscription.updated", {
        id: "sub_unknown_price",
        status: "active",
        ...subscriptionWithPrice(
          "price_totally_unrelated",
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        ),
      })
    );

    await postWebhook("{}");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });

  it("does not update the account when customer.subscription.updated reports a non-active status", async () => {
    const originalExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_canceling",
    });

    mockConstructEventAsync.mockResolvedValue(
      fakeEvent("evt_4", "customer.subscription.updated", {
        id: "sub_canceling",
        status: "canceled",
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          Math.floor(Date.now() / 1000)
        ),
      })
    );

    await postWebhook("{}");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });

  it("processes customer.subscription.deleted by clearing the subscription id and expiring the plan immediately", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
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
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_dup",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const event = fakeEvent("evt_dup", "customer.subscription.updated", {
      id: "sub_dup",
      status: "active",
      ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
    });
    mockConstructEventAsync.mockResolvedValue(event);

    const first = await postWebhook("{}");
    expect(first.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");

    const second = await postWebhook("{}");
    expect(second.status).toBe(200);
    const secondBody = await readJson<{ note: string }>(second);
    expect(secondBody.note).toBe("duplicate event");

    // 同じイベントIDでの処理済みマークが重複して増えていないこと。
    const eventRows = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM stripe_events WHERE id = ?`
    )
      .bind(event.id)
      .first<{ count: number }>();
    expect(eventRows?.count).toBe(1);
  });

  it("does not permanently mark an event as processed if handling it throws, so a Stripe retry can still succeed", async () => {
    // 実際に発生していたバグの再現テスト: 「処理済み」マークをswitch文の
    // 実行前に確定させていたため、途中で例外が起きるとイベントは
    // 「処理済み」のまま残り、Stripeが同じイベントIDで再送してきても
    // 二度とプランが反映されなくなっていた(顧客は決済済みなのに
    // アップグレードされない)。この回帰を防ぐテスト。
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_retry",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const event = fakeEvent(
      "evt_transient_failure",
      "customer.subscription.updated",
      {
        id: "sub_retry",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }
    );
    mockConstructEventAsync.mockResolvedValue(event);

    // applyEvent内のUPDATEが本物のDBエラーで失敗する状況(例: D1側の一時的な
    // 障害)を、accountsテーブルを一時的にリネームすることで再現する
    // (Stripe APIへの外部呼び出しが無くなったため、失敗点はDB層のみになる。
    // RENAME TOは既存の行データを保持したままテーブル名だけを変えるので、
    // 元に戻せば通常どおり動作する)。
    await env.DB.prepare(
      `ALTER TABLE accounts RENAME TO accounts_test_outage`
    ).run();

    // ここから先のアサーションが失敗しても、accountsテーブル名を必ず元に
    // 戻す(戻さないと、以後のテストがすべて「no such table: accounts」で
    // 壊れてしまう)。
    let eventRow: unknown;

    try {
      const first = await postWebhook("{}");
      expect(first.status).toBe(500);

      // イベントが「処理済み」のまま残っていないこと(accountsに触れずに確認できる)。
      eventRow = await env.DB.prepare(
        `SELECT id FROM stripe_events WHERE id = ?`
      )
        .bind(event.id)
        .first();
    } finally {
      await env.DB.prepare(
        `ALTER TABLE accounts_test_outage RENAME TO accounts`
      ).run();
    }

    expect(eventRow).toBeNull();

    const accountAfterFailure = await getAccount(accountId);
    expect(accountAfterFailure?.plan).toBe("free");

    // 2回目(Stripeからの再送を模したもの): 今度は成功する状況で、
    // 同じイベントIDでも正しく処理され、プランが反映されること。
    const retried = await postWebhook("{}");
    expect(retried.status).toBe(200);
    const retriedBody = await readJson<{ note?: string }>(retried);
    expect(retriedBody.note).toBeUndefined();

    const accountAfterRetry = await getAccount(accountId);
    expect(accountAfterRetry?.plan).toBe("premium");
  });
});
