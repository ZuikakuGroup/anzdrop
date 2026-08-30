import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeBillingCta,
  describeContract,
  loadPlanStatus,
  type PlanStatus,
} from "@/lib/account/planStatus";
import { INDEFINITE_PLAN_EXPIRES_AT } from "@/lib/plan";

function baseStatus(overrides: Partial<PlanStatus> = {}): PlanStatus {
  return {
    accountId: "acct-1",
    plan: "standard",
    planExpiresAt: "2026-09-28T00:00:00.000Z",
    subscription: null,
    ...overrides,
  };
}

describe("describeContract", () => {
  it("reports the free plan with no detail or note", () => {
    expect(
      describeContract(baseStatus({ plan: "free", planExpiresAt: null }))
    ).toEqual({ stateLabel: "無料プラン", detail: null, note: null });
  });

  it("reports an active card subscription with its next renewal date", () => {
    const view = describeContract(
      baseStatus({
        subscription: {
          state: "active",
          currentPeriodEnd: "2026-09-28T00:00:00.000Z",
        },
      })
    );

    expect(view.stateLabel).toBe("カードで自動更新中");
    expect(view.detail).toBe(
      `次回更新日: ${new Date("2026-09-28T00:00:00.000Z").toLocaleDateString("ja-JP")}`
    );
    expect(view.note).toBeNull();
  });

  it("falls back to planExpiresAt for the date when the subscription has no currentPeriodEnd", () => {
    const view = describeContract(
      baseStatus({
        planExpiresAt: "2026-10-01T00:00:00.000Z",
        subscription: { state: "active", currentPeriodEnd: null },
      })
    );

    expect(view.detail).toBe(
      `次回更新日: ${new Date("2026-10-01T00:00:00.000Z").toLocaleDateString("ja-JP")}`
    );
  });

  it("omits the date entirely when neither currentPeriodEnd nor planExpiresAt is available", () => {
    const view = describeContract(
      baseStatus({
        planExpiresAt: null,
        subscription: { state: "active", currentPeriodEnd: null },
      })
    );

    expect(view.detail).toBeNull();
  });

  it("reports a scheduled cancellation with an expiry date and an explanatory note", () => {
    const view = describeContract(
      baseStatus({
        subscription: {
          state: "canceling",
          currentPeriodEnd: "2026-09-28T00:00:00.000Z",
        },
      })
    );

    expect(view.stateLabel).toBe("解約予約中");
    expect(view.detail).toContain("有効期限:");
    expect(view.note).toBe(
      "自動更新は停止済みです。期限を過ぎると無料プランに戻ります。"
    );
  });

  it("reports a past_due subscription as payment-under-review without asserting a specific date", () => {
    const view = describeContract(
      baseStatus({
        subscription: { state: "past_due", currentPeriodEnd: null },
      })
    );

    expect(view.stateLabel).toBe("お支払いの確認中");
    // past_due では確定的な期限を出さない(current_period_end も
    // plan_expires_at も当てにならないため)。
    expect(view.detail).toBeNull();
    expect(view.note).toContain("お問い合わせ");
    expect(view.note).toContain("自動更新を停止");
  });

  it("still surfaces a past_due subscription even after the effective plan has already lapsed to free", () => {
    // 更新失敗直後は plan_expires_at が過去へ回り実効プランがすぐ free に
    // なりうる。それでも「解約すべき宙ぶらりんの購読がある」ことを出す。
    const view = describeContract(
      baseStatus({
        plan: "free",
        planExpiresAt: "2020-01-01T00:00:00.000Z",
        subscription: { state: "past_due", currentPeriodEnd: null },
      })
    );

    expect(view.stateLabel).toBe("お支払いの確認中");
    expect(view.stateLabel).not.toBe("無料プラン");
  });

  it("reports a paid plan without a Stripe subscription as a non-renewing period (Bitcoin top-up)", () => {
    const view = describeContract(
      baseStatus({
        plan: "premium",
        planExpiresAt: "2026-12-01T00:00:00.000Z",
        subscription: null,
      })
    );

    expect(view.stateLabel).toBe("有効期限あり（自動更新なし）");
    expect(view.detail).toContain("有効期限:");
    expect(view.note).toBe(
      "自動更新はありません。期限が切れる前に更新してください。"
    );
  });

  it("reports an indefinitely granted plan without an expiry date or renewal nag", () => {
    const view = describeContract(
      baseStatus({
        plan: "premium",
        planExpiresAt: INDEFINITE_PLAN_EXPIRES_AT,
        subscription: null,
      })
    );

    expect(view).toEqual({
      stateLabel: "利用中（無期限）",
      detail: null,
      note: null,
    });
  });
});

describe("describeBillingCta", () => {
  it("labels the CTA 解約する with a subdued tone while a card subscription is auto-renewing", () => {
    expect(describeBillingCta("active")).toEqual({
      label: "解約する",
      tone: "neutral",
    });
  });

  it("labels the CTA 解約を取り消す with a primary tone once the subscription is set to cancel (this is a recovery action)", () => {
    expect(describeBillingCta("canceling")).toEqual({
      label: "解約を取り消す",
      tone: "primary",
    });
  });

  it("keeps a primary payment CTA when there is no card subscription", () => {
    expect(describeBillingCta(null)).toEqual({
      label: "プラン・お支払いへ",
      tone: "primary",
    });
  });
});

describe("loadPlanStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(impl));
  }

  it("calls POST /api/billing/stripe/sync", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            accountId: "a",
            plan: "free",
            planExpiresAt: null,
            subscription: null,
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await loadPlanStatus();

    expect(fetchMock).toHaveBeenCalledWith("/api/billing/stripe/sync", {
      method: "POST",
    });
  });

  it("returns 'unauthenticated' on a 401", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ success: false, error: "x" }), {
          status: 401,
        })
    );

    await expect(loadPlanStatus()).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("returns 'error' on a 500 (not a redirect trigger)", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ success: false, error: "x" }), {
          status: 500,
        })
    );

    await expect(loadPlanStatus()).resolves.toEqual({ kind: "error" });
  });

  it("returns 'error' on a 200 body whose success flag is false", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ success: false, error: "x" }), {
          status: 200,
        })
    );

    await expect(loadPlanStatus()).resolves.toEqual({ kind: "error" });
  });

  it("returns 'error' when fetch itself rejects", async () => {
    stubFetch(() => Promise.reject(new Error("network down")));

    await expect(loadPlanStatus()).resolves.toEqual({ kind: "error" });
  });

  it("passes the sync payload through on success", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            accountId: "acct-42",
            plan: "premium",
            planExpiresAt: "2026-11-01T00:00:00.000Z",
            subscription: {
              state: "canceling",
              currentPeriodEnd: "2026-11-01T00:00:00.000Z",
            },
          }),
          { status: 200 }
        )
    );

    await expect(loadPlanStatus()).resolves.toEqual({
      kind: "ok",
      status: {
        accountId: "acct-42",
        plan: "premium",
        planExpiresAt: "2026-11-01T00:00:00.000Z",
        subscription: {
          state: "canceling",
          currentPeriodEnd: "2026-11-01T00:00:00.000Z",
        },
      },
    });
  });
});
