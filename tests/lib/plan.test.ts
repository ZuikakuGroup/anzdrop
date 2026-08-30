import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  getMaxFileSizeBytes,
  getMaxRetentionDays,
  isRetentionAllowedForPlan,
  isPreviewAllowedForPlan,
  isTurnstileRequiredForPlan,
  getUploadConcurrencyForPlan,
  effectivePlan,
  extendPaidPeriod,
  getAccountPlanInfo,
  downgradeExpiredCardPlan,
} from "@/lib/plan";
import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import { createTestEnv, clearAllTables, insertTestAccount, type TestEnv } from "@/test/env";

describe("getMaxFileSizeBytes", () => {
  it("matches the existing global limit for the free plan (no regression)", () => {
    expect(getMaxFileSizeBytes("free")).toBe(MAX_FILE_SIZE_BYTES);
  });

  it("gives standard a strictly larger limit than free, and premium a strictly larger limit than standard", () => {
    expect(getMaxFileSizeBytes("standard")).toBeGreaterThan(
      getMaxFileSizeBytes("free")
    );
    expect(getMaxFileSizeBytes("premium")).toBeGreaterThan(
      getMaxFileSizeBytes("standard")
    );
  });
});

describe("getMaxRetentionDays", () => {
  it("returns the longest selectable retention per plan, excluding the 'once' safety valve", () => {
    expect(getMaxRetentionDays("free")).toBe(7);
    expect(getMaxRetentionDays("standard")).toBe(15);
    expect(getMaxRetentionDays("premium")).toBe(30);
  });

  it("is monotonically non-decreasing from free to standard to premium", () => {
    expect(getMaxRetentionDays("standard")).toBeGreaterThanOrEqual(
      getMaxRetentionDays("free")
    );
    expect(getMaxRetentionDays("premium")).toBeGreaterThanOrEqual(
      getMaxRetentionDays("standard")
    );
  });

  it("matches the largest non-'once' value actually present in PLAN_LIMITS", () => {
    for (const plan of ["free", "standard", "premium"] as const) {
      const nonOnce = PLAN_LIMITS[plan].allowedRetentions.filter(
        (retention) => retention !== "once"
      );
      const expected = Math.max(
        ...nonOnce.map((retention) => Number(retention.replace("d", "")))
      );
      expect(getMaxRetentionDays(plan)).toBe(expected);
    }
  });
});

describe("isRetentionAllowedForPlan", () => {
  it("allows every pre-existing retention option on the free plan", () => {
    for (const retention of ["once", "1d", "3d", "7d"] as const) {
      expect(isRetentionAllowedForPlan(retention, "free")).toBe(true);
    }
  });

  it("does not allow 15d or 30d on the free plan", () => {
    expect(isRetentionAllowedForPlan("15d", "free")).toBe(false);
    expect(isRetentionAllowedForPlan("30d", "free")).toBe(false);
  });

  it("allows 15d but not 30d on the standard plan", () => {
    expect(isRetentionAllowedForPlan("15d", "standard")).toBe(true);
    expect(isRetentionAllowedForPlan("30d", "standard")).toBe(false);
  });

  it("allows both 15d and 30d on the premium plan", () => {
    expect(isRetentionAllowedForPlan("15d", "premium")).toBe(true);
    expect(isRetentionAllowedForPlan("30d", "premium")).toBe(true);
  });
});

describe("PLAN_LIMITS", () => {
  it("free plan's allowed retentions match the pre-existing Retention values exactly", () => {
    expect(PLAN_LIMITS.free.allowedRetentions.sort()).toEqual(
      ["once", "1d", "3d", "7d"].sort()
    );
  });

  it("only the premium plan enables preview", () => {
    expect(PLAN_LIMITS.free.previewEnabled).toBe(false);
    expect(PLAN_LIMITS.standard.previewEnabled).toBe(false);
    expect(PLAN_LIMITS.premium.previewEnabled).toBe(true);
  });

  it("skips Turnstile for standard and premium, but not free", () => {
    expect(PLAN_LIMITS.free.skipTurnstile).toBe(false);
    expect(PLAN_LIMITS.standard.skipTurnstile).toBe(true);
    expect(PLAN_LIMITS.premium.skipTurnstile).toBe(true);
  });

  it("gives premium a strictly higher upload concurrency than free/standard", () => {
    expect(PLAN_LIMITS.premium.uploadConcurrency).toBeGreaterThan(
      PLAN_LIMITS.standard.uploadConcurrency
    );
    expect(PLAN_LIMITS.standard.uploadConcurrency).toBe(
      PLAN_LIMITS.free.uploadConcurrency
    );
  });
});

describe("isPreviewAllowedForPlan", () => {
  it("does not allow preview on the free or standard plan", () => {
    expect(isPreviewAllowedForPlan("free")).toBe(false);
    expect(isPreviewAllowedForPlan("standard")).toBe(false);
  });

  it("allows preview on the premium plan", () => {
    expect(isPreviewAllowedForPlan("premium")).toBe(true);
  });
});

describe("isTurnstileRequiredForPlan", () => {
  it("requires Turnstile only on the free plan", () => {
    expect(isTurnstileRequiredForPlan("free")).toBe(true);
    expect(isTurnstileRequiredForPlan("standard")).toBe(false);
    expect(isTurnstileRequiredForPlan("premium")).toBe(false);
  });
});

describe("getUploadConcurrencyForPlan", () => {
  it("returns the configured concurrency per plan", () => {
    expect(getUploadConcurrencyForPlan("free")).toBe(
      PLAN_LIMITS.free.uploadConcurrency
    );
    expect(getUploadConcurrencyForPlan("premium")).toBe(
      PLAN_LIMITS.premium.uploadConcurrency
    );
  });
});

describe("effectivePlan", () => {
  it("treats a free-plan account as free regardless of expiry", () => {
    expect(effectivePlan("free", null)).toBe("free");
    expect(effectivePlan("free", "2099-01-01T00:00:00.000Z")).toBe("free");
  });

  it("treats a standard/premium account with no expiry as free (defensive default)", () => {
    expect(effectivePlan("standard", null)).toBe("free");
    expect(effectivePlan("premium", null)).toBe("free");
  });

  it("treats a standard/premium account with a future expiry as itself", () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    expect(effectivePlan("standard", future)).toBe("standard");
    expect(effectivePlan("premium", future)).toBe("premium");
  });

  it("treats a standard/premium account with a past expiry as free (lapsed Bitcoin top-up)", () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    expect(effectivePlan("standard", past)).toBe("free");
    expect(effectivePlan("premium", past)).toBe("free");
  });
});

describe("extendPaidPeriod", () => {
  it("extends from now when there is no current expiry", () => {
    const before = Date.now();
    const result = new Date(extendPaidPeriod(null, 30)).getTime();
    const after = Date.now();

    expect(result).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
    expect(result).toBeLessThanOrEqual(after + 30 * 24 * 60 * 60 * 1000);
  });

  it("extends from now when the current expiry is already in the past (lapsed)", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = new Date(extendPaidPeriod(past, 30)).getTime();

    // 過去の期限からではなく「今から」30日後になっているはず。
    expect(result).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it("stacks on top of a still-future expiry instead of overwriting it", () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = new Date(extendPaidPeriod(future, 30)).getTime();
    const expectedApprox = new Date(future).getTime() + 30 * 24 * 60 * 60 * 1000;

    expect(Math.abs(result - expectedApprox)).toBeLessThan(1000);
  });
});

describe("getAccountPlanInfo", () => {
  let env: TestEnv;
  let dispose: () => Promise<void>;

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
  });

  it("returns free with no expiry when there is no account id (anonymous)", async () => {
    await expect(getAccountPlanInfo(null, env)).resolves.toEqual({
      plan: "free",
      planExpiresAt: null,
    });
  });

  it("returns free when the account id does not exist in the DB", async () => {
    await expect(
      getAccountPlanInfo("no-such-account", env)
    ).resolves.toEqual({ plan: "free", planExpiresAt: null });
  });

  it("returns the free plan for a free-plan account", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });

    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "free",
      planExpiresAt: null,
    });
  });

  it("returns the standard plan for a standard account with a future expiry", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: future,
    });

    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "standard",
      planExpiresAt: future,
    });
  });

  it("returns the premium plan for a premium account with a future expiry", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: future,
    });

    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "premium",
      planExpiresAt: future,
    });
  });

  it("treats a legacy 'paid' DB value as premium (backward compatibility)", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: future,
    });

    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "premium",
      planExpiresAt: future,
    });
  });

  it("returns free (but preserves the stale expiry value) for a premium account whose expiry has lapsed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: past,
    });

    // effectivePlanはlapsed(期限切れ)をfreeとして扱うが、DB上のplan_expires_at
    // 自体はここでは書き換えない(表示用の情報としてそのまま返す)。
    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "free",
      planExpiresAt: past,
    });
  });
});

describe("downgradeExpiredCardPlan", () => {
  let env: TestEnv;
  let dispose: () => Promise<void>;

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
  });

  async function insertPaidBtcPayment(
    accountId: string,
    extendsPlanUntil: string,
    chargeId = crypto.randomUUID()
  ): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        chargeId,
        extendsPlanUntil,
        new Date().toISOString()
      )
      .run();
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

  it("expires the plan to now and clears the subscription pointer when there is no Bitcoin prepayment (match by subscription id)", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_x",
    });

    const before = Date.now();
    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_x" });
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan).toBe("free");
    const expiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 1000);
  });

  it("keeps a Bitcoin-prepaid future expiry (and its tier) instead of moving it back to now", async () => {
    const btcUntil = new Date(
      Date.now() + 40 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: btcUntil,
      stripeSubscriptionId: "sub_y",
    });
    await insertPaidBtcPayment(accountId, btcUntil);

    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_y" });

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBeNull();
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(btcUntil);
  });

  it("uses the latest of several Bitcoin prepayments as the floor", async () => {
    const near = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const far = new Date(Date.now() + 55 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: far,
      stripeSubscriptionId: "sub_z",
    });
    await insertPaidBtcPayment(accountId, near, "charge_near");
    await insertPaidBtcPayment(accountId, far, "charge_far");

    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_z" });

    const account = await getAccount(accountId);
    expect(account?.plan_expires_at).toBe(far);
  });

  it("drops the plan to what the still-valid Bitcoin payment actually paid for (premium card, standard top-up -> standard)", async () => {
    const btcUntil = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: btcUntil,
      stripeSubscriptionId: "sub_tier_mismatch",
    });
    // standard 向けに支払われた Bitcoin の前払い。
    await env.DB.prepare(
      `INSERT INTO btc_payments
         (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'standard', ?)`
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        "charge_std_topup",
        btcUntil,
        new Date().toISOString()
      )
      .run();

    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_tier_mismatch" });

    const account = await getAccount(accountId);
    // premium は残らず、支払った standard に落ちる。期限は Bitcoin 分だけ残る。
    expect(account?.plan).toBe("standard");
    expect(account?.plan_expires_at).toBe(btcUntil);
  });

  it("takes the highest tier when multiple still-valid Bitcoin payments differ in plan", async () => {
    const stdUntil = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const premUntil = new Date(
      Date.now() + 40 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: premUntil,
      stripeSubscriptionId: "sub_multi_tier",
    });
    await env.DB.prepare(
      `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'standard', ?)`
    )
      .bind(crypto.randomUUID(), accountId, "c_std", stdUntil, new Date().toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(crypto.randomUUID(), accountId, "c_prem", premUntil, new Date().toISOString())
      .run();

    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_multi_tier" });

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(premUntil);
  });

  it("collapses tier and expiry independently across live Bitcoin payments (matches the btc webhook's 'keep higher tier + extend' stacking)", async () => {
    // {premium, 近い期限} + {standard, 遠い期限} の生存 BTC が同居するケース。
    // accounts は plan / plan_expires_at を1つずつしか持てず、btc webhook 自身も
    // standard 支払い確定時に「premium 維持 + 遠い期限へ延長」で畳んでいるため、
    // ここでも「最上位 tier を最遠の期限まで」で畳む(その挙動を固定する)。
    const premNear = new Date(
      Date.now() + 8 * 24 * 60 * 60 * 1000
    ).toISOString();
    const stdFar = new Date(
      Date.now() + 50 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: stdFar,
      stripeSubscriptionId: "sub_cross",
    });
    await env.DB.prepare(
      `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'premium', ?)`
    )
      .bind(crypto.randomUUID(), accountId, "c_prem_near", premNear, new Date().toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', ?, 'standard', ?)`
    )
      .bind(crypto.randomUUID(), accountId, "c_std_far", stdFar, new Date().toISOString())
      .run();

    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_cross" });

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
    expect(account?.plan_expires_at).toBe(stdFar);
  });

  it("ignores a 'paid' row whose extends_plan_until is NULL (charge confirmed but expiry write not yet applied)", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_null_expiry",
    });
    await env.DB.prepare(
      `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, extends_plan_until, plan, created_at)
       VALUES (?, ?, ?, 'paid', NULL, 'premium', ?)`
    )
      .bind(crypto.randomUUID(), accountId, "c_null", new Date().toISOString())
      .run();

    const before = Date.now();
    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_null_expiry" });
    const after = Date.now();

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("free");
    const expiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 1000);
  });

  it("ignores a Bitcoin payment whose extends_plan_until is already in the past", async () => {
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_past_btc",
    });
    await insertPaidBtcPayment(
      accountId,
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    );

    const before = Date.now();
    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_past_btc" });
    const after = Date.now();

    const account = await getAccount(accountId);
    const expiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 1000);
  });

  it("only affects another account's Bitcoin payments through its own account_id", async () => {
    const victim = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      stripeSubscriptionId: "sub_victim",
    });
    const other = await insertTestAccount(env, { plan: "free" });
    // 別アカウントの先の Bitcoin 前払い。victim の失効に影響してはいけない。
    await insertPaidBtcPayment(
      other.accountId,
      new Date(Date.now() + 99 * 24 * 60 * 60 * 1000).toISOString()
    );

    const before = Date.now();
    await downgradeExpiredCardPlan(env, { subscriptionId: "sub_victim" });
    const after = Date.now();

    const account = await getAccount(victim.accountId);
    const expiry = new Date(account?.plan_expires_at ?? 0).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before - 1000);
    expect(expiry).toBeLessThanOrEqual(after + 1000);
  });

  it("does not touch a row whose subscription id no longer matches (accountId + subscriptionId form)", async () => {
    const originalExpiry = new Date(
      Date.now() + 15 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: originalExpiry,
      stripeSubscriptionId: "sub_current",
    });

    // 同期の実行中に別 Subscription へ切り替わったケースを模す。
    await downgradeExpiredCardPlan(env, {
      accountId,
      subscriptionId: "sub_stale",
    });

    const account = await getAccount(accountId);
    expect(account?.stripe_subscription_id).toBe("sub_current");
    expect(account?.plan_expires_at).toBe(originalExpiry);
  });
});
