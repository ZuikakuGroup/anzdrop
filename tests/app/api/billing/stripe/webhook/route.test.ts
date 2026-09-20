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
  // metadataフォールバック対象のイベントは通常、Stripe上でもactiveのまま。
  // 終端状態や別Subscriptionとの衝突を検証するテストでは上書きする。
  mockSubscriptionsRetrieve.mockResolvedValue({ status: "active" });
});

async function signStripeWebhook(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000)
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${payload}`)
    )
  );
  const hex = Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `t=${timestamp},v1=${hex}`;
}

async function postWebhook(
  eventOrBody: object | string,
  options?: { signature?: string | null }
) {
  const { POST } = await import("@/app/api/billing/stripe/webhook/route");
  const rawBody =
    typeof eventOrBody === "string" ? eventOrBody : JSON.stringify(eventOrBody);

  let signature: string | undefined;
  if (options && "signature" in options) {
    signature = options.signature || undefined;
  } else {
    signature = await signStripeWebhook(rawBody, env.STRIPE_WEBHOOK_SECRET);
  }

  return POST(
    new Request("http://localhost/api/billing/stripe/webhook", {
      method: "POST",
      headers: signature
        ? { "stripe-signature": signature, "content-type": "application/json" }
        : { "content-type": "application/json" },
      body: rawBody,
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
    const response = await postWebhook("{}", { signature: null });

    expect(response.status).toBe(400);
  });

  it("returns 400 when signature verification fails", async () => {
    const response = await postWebhook(
      fakeEvent("evt_bad_sig", "customer.subscription.updated", { id: "sub_x" }),
      { signature: "t=1,v1=00" }
    );

    expect(response.status).toBe(400);
  });

  it("processes customer.subscription.updated for an active subscription (initial activation and renewals alike)", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_existing",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_3", "customer.subscription.updated", {
        id: "sub_existing",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("moves plan_expires_at forward on renewal (later period end)", async () => {
    const oldExpiry = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: oldExpiry,
      stripeSubscriptionId: "sub_renew",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 35 * 24 * 60 * 60;

await postWebhook(fakeEvent("evt_renew", "customer.subscription.updated", {
        id: "sub_renew",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    const account = await getAccount(accountId);
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not move plan_expires_at backward when the event carries an earlier period end than what is already stored, but still follows the plan", async () => {
    // 順不同でイベントが届く / Bitcoin の期間チャージでカードの請求期間より
    // 先まで有効期限が積まれている等のケースで、より手前の日付で上書きして
    // 課金済みの期間を失わせないこと(主経路のガード)。
    const laterExpiry = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: laterExpiry,
      stripeSubscriptionId: "sub_out_of_order",
    });
    const earlierPeriodEndUnix =
      Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_out_of_order", "customer.subscription.updated", {
        id: "sub_out_of_order",
        status: "active",
        // 価格は premium に変わっている(プランは実態へ追従させるべき)。
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          earlierPeriodEndUnix
        ),
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 有効期限は後退していない。
    expect(account?.plan_expires_at).toBe(laterExpiry);
    // プランは実態(premium)へ追従している。
    expect(account?.plan).toBe("premium");
  });

  it("sets plan_expires_at from the event when the account has no stored expiry yet (first activation)", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      planExpiresAt: null,
      stripeSubscriptionId: "sub_first_activation",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

await postWebhook(fakeEvent("evt_first", "customer.subscription.updated", {
        id: "sub_first_activation",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_STANDARD, periodEndUnix),
      }));

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not update any account when no row has a matching stripe_subscription_id", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_no_match", "customer.subscription.updated", {
        id: "sub_never_registered",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

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
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "canceled" });

const response = await postWebhook(fakeEvent("evt_fallback", "customer.subscription.updated", {
        id: "sub_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    expect(response.status).toBe(200);
    // 衝突チェックのため、上書き対象になる「別の」Subscriptionを実際に
    // Stripeへ問い合わせていること(上で2回目の応答をcanceledにしているため、
    // 衝突なしと判定されフォールバックが適用される)。
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

const response = await postWebhook(fakeEvent("evt_conflict", "customer.subscription.updated", {
        id: "sub_new_attempt",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          laterPeriodEndUnix
        ),
      }));

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
    // 全体を失敗させ(Hibiki の HIBIKI_HANDLER_FAILED / 500)、Stripeの再送に賭ける。
    const originalExpiry = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_other_unknown_state",
    });
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce({ status: "active" })
      .mockRejectedValueOnce(
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
const response = await postWebhook(event);

    expect(response.status).toBe(500);

    // アカウントは一切変更されていないこと。
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_other_unknown_state");
    expect(account?.plan_expires_at).toBe(originalExpiry);

    // 失敗時は完了マークを付けないため、Stripeの再送を受け付けられること。
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
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "canceled" });

const response = await postWebhook(fakeEvent("evt_stale_fallback", "customer.subscription.updated", {
        id: "sub_older_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          earlierPeriodEndUnix
        ),
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 何も上書きされていないこと(有効期限も、紐づくSubscription IDも)。
    expect(account?.plan_expires_at).toBe(laterExpiry);
    expect(account?.stripe_subscription_id).toBe("sub_newer_valid");
  });

  it("does not overwrite the pointer via the metadata fallback if accounts.stripe_subscription_id is re-pointed mid-handler (atomic UPDATE guard)", async () => {
    // フォールバックは「SELECT で現状確認 → UPDATE」の2段階。その隙間に別イベント/
    // 別タブが stripe_subscription_id を張り替えるレースを想定し、UPDATE 自体の
    // WHERE 句で弾けること(古い subscription.id で新しい契約の追跡を潰さない)を
    // 確認する。
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_stale",
    });
    await env.DB.prepare(
      `UPDATE accounts SET stripe_subscription_id = ? WHERE id = ?`
    )
      .bind("sub_read_as_this", accountId)
      .run();

    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    // 衝突チェックの retrieve() が呼ばれた時点で(＝現状確認の SELECT より後)、
    // 別処理が pointer をさらに別の Subscription へ張り替えたことにする。
    mockSubscriptionsRetrieve.mockImplementation(async (subscriptionId) => {
      if (subscriptionId === "sub_stale") {
        return { status: "active" };
      }

      await env.DB.prepare(
        `UPDATE accounts SET stripe_subscription_id = ? WHERE id = ?`
      )
        .bind("sub_repointed_concurrently", accountId)
        .run();
      return { status: "canceled" };
    });

const response = await postWebhook(fakeEvent("evt_race", "customer.subscription.updated", {
        id: "sub_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 並行して張り替えられた pointer は、古いイベントで上書きされない。
    expect(account?.stripe_subscription_id).toBe("sub_repointed_concurrently");
    expect(account?.plan).toBe("free");
  });

  it("does not move plan_expires_at backward via the metadata fallback if it is bumped forward mid-handler (atomic UPDATE guard)", async () => {
    // 事前の isExpirySafe チェック(SELECT 時点の値で判定)は通っても、その後
    // UPDATE までの間に別処理がより新しい期限を書いた場合、UPDATE 自体の
    // WHERE 句(plan_expires_at <= newExpiresAt)で弾けることを確認する。
    const laterExpiry = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      planExpiresAt: new Date(
        Date.now() + 10 * 24 * 60 * 60 * 1000
      ).toISOString(),
      stripeSubscriptionId: "sub_other",
    });

    // イベントの期間末は「SELECT 時点の期限(10日後)」より後だが、
    // 「並行して書かれる期限(60日後)」より前。
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    mockSubscriptionsRetrieve.mockImplementation(async (subscriptionId) => {
      if (subscriptionId === "sub_stale") {
        return { status: "active" };
      }

      await env.DB.prepare(
        `UPDATE accounts SET plan_expires_at = ? WHERE id = ?`
      )
        .bind(laterExpiry, accountId)
        .run();
      return { status: "canceled" };
    });

const response = await postWebhook(fakeEvent("evt_expiry_race", "customer.subscription.updated", {
        id: "sub_stale",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 並行して書かれた新しい期限は、古いイベントで後退させられない。
    expect(account?.plan_expires_at).toBe(laterExpiry);
    expect(account?.stripe_subscription_id).toBe("sub_other");
  });

  it("downgrades from premium to standard when the subscription's price changes to the standard price", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      stripeSubscriptionId: "sub_downgrade",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

await postWebhook(fakeEvent("evt_downgrade", "customer.subscription.updated", {
        id: "sub_downgrade",
        status: "active",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_STANDARD, periodEndUnix),
      }));

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

await postWebhook(fakeEvent("evt_unknown_price_update", "customer.subscription.updated", {
        id: "sub_unknown_price",
        status: "active",
        ...subscriptionWithPrice(
          "price_totally_unrelated",
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        ),
      }));

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });

  it("does not update the account when customer.subscription.updated reports a non-terminal, non-active status (past_due)", async () => {
    const originalExpiry = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_past_due",
    });

await postWebhook(fakeEvent("evt_4", "customer.subscription.updated", {
        id: "sub_past_due",
        status: "past_due",
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        ),
      }));

    const account = await getAccount(accountId);
    // past_due は「終端」ではない(まだ復帰しうる)ため、accounts は触らない。
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(originalExpiry);
    expect(account?.stripe_subscription_id).toBe("sub_past_due");
  });

  it("clears the stale pointer and downgrades when customer.subscription.updated reports a terminal status (mirrors sync, so an incomplete_expired transition delivered only via .updated is still cleaned up)", async () => {
    // 「決済フォームを開いただけで離脱」した incomplete の Subscription は、
    // 約23時間後に incomplete_expired へ status 遷移する更新イベントだけが届き
    // (deleted は来ない)。この場合でも accounts.stripe_subscription_id の
    // ゴミポインタが残らないこと。
    const paidUntil = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      planExpiresAt: paidUntil,
      stripeSubscriptionId: "sub_incomplete_expired",
    });

const before = Date.now();
    const response = await postWebhook(fakeEvent("evt_incomplete_expired", "customer.subscription.updated", {
        id: "sub_incomplete_expired",
        status: "incomplete_expired",
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_STANDARD,
          Math.floor(Date.now() / 1000)
        ),
      }));
    const after = Date.now();

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan).toBe("free");
    const expiresAtMs = new Date(account!.plan_expires_at!).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 1000);
  });

  it("downgrades and keeps a Bitcoin-prepaid future period when customer.subscription.updated reports 'canceled'", async () => {
    // 期間末解約後などに canceled が updated だけで届くケース。deleted と同じく
    // Bitcoin 前払い分は消さない。
    const btcPaidUntil = new Date(
      Date.now() + 40 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: btcPaidUntil,
      stripeSubscriptionId: "sub_canceled_updated",
    });
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_updated_canceled",
        btcPaidUntil,
        new Date().toISOString()
      )
      .run();

await postWebhook(fakeEvent("evt_canceled_updated", "customer.subscription.updated", {
        id: "sub_canceled_updated",
        status: "canceled",
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          Math.floor(Date.now() / 1000)
        ),
      }));

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan_expires_at).toBe(btcPaidUntil);
    expect(account?.plan).toBe("premium");
  });

  it.each([
    {
      terminalEventType: "customer.subscription.updated",
      terminalStatus: "incomplete_expired",
    },
    {
      terminalEventType: "customer.subscription.updated",
      terminalStatus: "canceled",
    },
    {
      terminalEventType: "customer.subscription.updated",
      terminalStatus: "unpaid",
    },
    {
      terminalEventType: "customer.subscription.deleted",
      terminalStatus: "canceled",
    },
  ])(
    "does not restore a paid plan from an out-of-order active event after $terminalEventType ($terminalStatus)",
    async ({ terminalEventType, terminalStatus }) => {
      const subscriptionId = `sub_terminal_${terminalEventType}_${terminalStatus}`;
      const { accountId } = await insertTestAccount(env, {
        plan: "premium",
        planExpiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
        stripeSubscriptionId: subscriptionId,
      });
      const terminalSubscription =
        terminalEventType === "customer.subscription.deleted"
          ? { id: subscriptionId }
          : {
              id: subscriptionId,
              status: terminalStatus,
              ...subscriptionWithPrice(
                env.STRIPE_PRICE_ID_PREMIUM,
                Math.floor(Date.now() / 1000)
              ),
            };
      const staleActiveSubscription = {
        id: subscriptionId,
        status: "active",
        metadata: { accountId },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        ),
      };

      const __terminalEvent = fakeEvent(
            `evt_terminal_${terminalEventType}_${terminalStatus}`,
            terminalEventType,
            terminalSubscription
          );
      const __staleActiveEvent = fakeEvent(
            `evt_stale_active_${terminalEventType}_${terminalStatus}`,
            "customer.subscription.updated",
            staleActiveSubscription
          );
      mockSubscriptionsRetrieve.mockResolvedValue({ status: terminalStatus });

      const terminalResponse = await postWebhook(__terminalEvent);
      const accountAfterTerminalEvent = await getAccount(accountId);
      const staleActiveResponse = await postWebhook(__staleActiveEvent);

      expect(terminalResponse.status).toBe(200);
      expect(staleActiveResponse.status).toBe(200);
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith(subscriptionId);
      expect(await getAccount(accountId)).toEqual(accountAfterTerminalEvent);
      expect(accountAfterTerminalEvent?.plan).toBe("free");
      expect(accountAfterTerminalEvent?.stripe_subscription_id).toBeNull();
    }
  );

  it("processes customer.subscription.deleted by clearing the subscription id and expiring the plan immediately", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_deleted",
    });

const before = Date.now();
    const response = await postWebhook(fakeEvent("evt_5", "customer.subscription.deleted", {
        id: "sub_deleted",
      }));
    const after = Date.now();

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    const expiresAtMs = new Date(account!.plan_expires_at!).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before);
    expect(expiresAtMs).toBeLessThanOrEqual(after);
  });

  it("keeps a Bitcoin-prepaid future period on customer.subscription.deleted instead of expiring immediately", async () => {
    // カード期間末解約 → その後 Bitcoin で前払い → カード期間末に deleted が届く、
    // という切り替え順序。deleted の即時ダウングレードで Bitcoin 前払い分を
    // 消してはいけない。
    const btcPaidUntil = new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: btcPaidUntil,
      stripeSubscriptionId: "sub_switched_to_btc",
    });
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_switch",
        btcPaidUntil,
        new Date().toISOString()
      )
      .run();

const response = await postWebhook(fakeEvent("evt_deleted_btc", "customer.subscription.deleted", {
        id: "sub_switched_to_btc",
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    // Bitcoin 前払いの期限はそのまま。
    expect(account?.plan_expires_at).toBe(btcPaidUntil);
  });

  it("still expires immediately on customer.subscription.deleted when the only Bitcoin payment is already spent or still pending", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(
        Date.now() + 20 * 24 * 60 * 60 * 1000
      ).toISOString(),
      stripeSubscriptionId: "sub_no_live_btc",
    });
    // 過去に消費済みの paid な支払い(期限は過去)。
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_old",
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      )
      .run();
    // 未確定(pending)の支払い(先の期限が入っていても効かせない)。
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'pending', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_pending",
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      )
      .run();

const before = Date.now();
    await postWebhook(fakeEvent("evt_deleted_no_live_btc", "customer.subscription.deleted", {
        id: "sub_no_live_btc",
      }));
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan).toBe("free");
    const expiresAtMs = new Date(account!.plan_expires_at!).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 1000);
  });

  it("acknowledges unhandled event types without making any DB change", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });

    // Hibiki が対応するイベントでもハンドラ未登録なら 204。
    // 完全未対応イベントは 200。どちらも DB は触らない。
    const knownUnhandled = await postWebhook(
      fakeEvent("evt_6", "customer.updated", { id: "cus_whatever" })
    );
    const unknown = await postWebhook(
      fakeEvent("evt_unknown", "radar.early_fraud_warning.created", {
        id: "issfr_1",
      })
    );

    expect(knownUnhandled.status).toBe(204);
    expect(unknown.status).toBe(200);
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
const first = await postWebhook(event);
    expect(first.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");

    const second = await postWebhook(event);
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
    // 完了マークは業務処理の成功後にだけ付ける。失敗したイベントは
    // stripe_events に残らないので、Stripe再送で再実行できる。
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
      const first = await postWebhook(event);
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
    const retried = await postWebhook(event);
    expect(retried.status).toBe(200);
    const retriedBody = await readJson<{ note?: string }>(retried);
    expect(retriedBody.note).toBeUndefined();

    const accountAfterRetry = await getAccount(accountId);
    expect(accountAfterRetry?.plan).toBe("premium");
  });

  it("activates the plan for a trialing subscription (free trial), not only 'active'", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "free",
      stripeSubscriptionId: "sub_trial",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_trialing", "customer.subscription.updated", {
        id: "sub_trial",
        status: "trialing",
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_STANDARD, periodEndUnix),
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
    expect(new Date(account!.plan_expires_at!).getTime()).toBe(
      periodEndUnix * 1000
    );
  });

  it("does not touch the account when an active subscription carries no billing period (no items)", async () => {
    const originalExpiry = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_no_period",
    });

const response = await postWebhook(fakeEvent("evt_no_period", "customer.subscription.updated", {
        id: "sub_no_period",
        status: "active",
        items: { data: [] },
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });

  it("acknowledges customer.subscription.deleted for an unknown subscription id without affecting other accounts", async () => {
    const otherExpiry = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: otherExpiry,
      stripeSubscriptionId: "sub_unrelated_still_active",
    });

const response = await postWebhook(fakeEvent("evt_deleted_unknown", "customer.subscription.deleted", {
        id: "sub_never_seen_here",
      }));

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_unrelated_still_active");
    expect(account?.plan_expires_at).toBe(otherExpiry);
  });

  it("does not fall back via metadata.accountId when the referenced account no longer exists, and leaves unrelated accounts untouched", async () => {
    // 初回 UPDATE がどの行にもマッチせず(該当 stripe_subscription_id 無し)、
    // metadata.accountId も既に存在しないアカウントを指している場合、
    // 例外を投げずに 200 で終わり、無関係なアカウントにも一切触れないこと。
    const bystanderExpiry = new Date(
      Date.now() + 25 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId: bystanderId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: bystanderExpiry,
      stripeSubscriptionId: "sub_bystander",
    });
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_ghost_account", "customer.subscription.updated", {
        id: "sub_for_deleted_account",
        status: "active",
        metadata: { accountId: "acct-that-was-deleted", plan: "premium" },
        ...subscriptionWithPrice(env.STRIPE_PRICE_ID_PREMIUM, periodEndUnix),
      }));

    expect(response.status).toBe(200);
    // 現在ポインタを持たない(削除済み)アカウントなので衝突チェックも走らない。
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();

    const bystander = await getAccount(bystanderId);
    expect(bystander?.plan).toBe("standard");
    expect(bystander?.plan_expires_at).toBe(bystanderExpiry);
    expect(bystander?.stripe_subscription_id).toBe("sub_bystander");
  });

  it("skips the metadata.accountId fallback when the currently-linked subscription is trialing (not only 'active')", async () => {
    // 衝突チェック(webhook/route.ts)は active だけでなく trialing も
    // 「まだ生きている別サブスク」として扱う。trialing を落とす回帰を防ぐ。
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(
        Date.now() + 10 * 24 * 60 * 60 * 1000
      ).toISOString(),
      stripeSubscriptionId: "sub_other_trialing",
    });
    mockSubscriptionsRetrieve.mockResolvedValue({ status: "trialing" });

    const laterPeriodEndUnix =
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;

const response = await postWebhook(fakeEvent("evt_conflict_trialing", "customer.subscription.updated", {
        id: "sub_new_attempt",
        status: "active",
        metadata: { accountId, plan: "premium" },
        ...subscriptionWithPrice(
          env.STRIPE_PRICE_ID_PREMIUM,
          laterPeriodEndUnix
        ),
      }));

    expect(response.status).toBe(200);
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_other_trialing");

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_other_trialing");
    expect(new Date(account!.plan_expires_at!).getTime()).toBeLessThan(
      laterPeriodEndUnix * 1000
    );
  });
});
