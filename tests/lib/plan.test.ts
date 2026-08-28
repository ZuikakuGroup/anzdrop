import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  getMaxFileSizeBytes,
  isRetentionAllowedForPlan,
  isPreviewAllowedForPlan,
  isTurnstileRequiredForPlan,
  getUploadConcurrencyForPlan,
  effectivePlan,
  extendPaidPeriod,
  getAccountPlanInfo,
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
