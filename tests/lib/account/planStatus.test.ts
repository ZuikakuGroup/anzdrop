import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeContract,
  loadPlanStatus,
  type PlanStatus,
} from "@/lib/account/planStatus";

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
