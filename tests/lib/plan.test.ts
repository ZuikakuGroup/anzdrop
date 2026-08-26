import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  getMaxFileSizeBytes,
  isRetentionAllowedForPlan,
  isPreviewAllowedForPlan,
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

  it("gives the paid plan a strictly larger limit", () => {
    expect(getMaxFileSizeBytes("paid")).toBeGreaterThan(
      getMaxFileSizeBytes("free")
    );
  });
});

describe("isRetentionAllowedForPlan", () => {
  it("allows every pre-existing retention option on the free plan", () => {
    for (const retention of ["once", "1d", "3d", "7d"] as const) {
      expect(isRetentionAllowedForPlan(retention, "free")).toBe(true);
    }
  });

  it("does not allow 30d on the free plan", () => {
    expect(isRetentionAllowedForPlan("30d", "free")).toBe(false);
  });

  it("allows 30d on the paid plan", () => {
    expect(isRetentionAllowedForPlan("30d", "paid")).toBe(true);
  });
});

describe("PLAN_LIMITS", () => {
  it("free plan's allowed retentions match the pre-existing Retention values exactly", () => {
    expect(PLAN_LIMITS.free.allowedRetentions.sort()).toEqual(
      ["once", "1d", "3d", "7d"].sort()
    );
  });

  it("only the paid plan enables preview", () => {
    expect(PLAN_LIMITS.free.previewEnabled).toBe(false);
    expect(PLAN_LIMITS.paid.previewEnabled).toBe(true);
  });
});

describe("isPreviewAllowedForPlan", () => {
  it("does not allow preview on the free plan", () => {
    expect(isPreviewAllowedForPlan("free")).toBe(false);
  });

  it("allows preview on the paid plan", () => {
    expect(isPreviewAllowedForPlan("paid")).toBe(true);
  });
});

describe("effectivePlan", () => {
  it("treats a free-plan account as free regardless of expiry", () => {
    expect(effectivePlan("free", null)).toBe("free");
    expect(effectivePlan("free", "2099-01-01T00:00:00.000Z")).toBe("free");
  });

  it("treats a paid account with no expiry as free (defensive default)", () => {
    expect(effectivePlan("paid", null)).toBe("free");
  });

  it("treats a paid account with a future expiry as paid", () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    expect(effectivePlan("paid", future)).toBe("paid");
  });

  it("treats a paid account with a past expiry as free (lapsed Bitcoin top-up)", () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    expect(effectivePlan("paid", past)).toBe("free");
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

  it("returns the paid plan for a paid account with a future expiry", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: future,
    });

    await expect(getAccountPlanInfo(accountId, env)).resolves.toEqual({
      plan: "paid",
      planExpiresAt: future,
    });
  });

  it("returns free (but preserves the stale expiry value) for a paid account whose expiry has lapsed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
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
