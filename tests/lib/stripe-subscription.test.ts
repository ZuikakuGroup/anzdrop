import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  getSubscriptionPeriodEnd,
  isActiveSubscriptionStatus,
  isDeadSubscriptionStatus,
  planFromSubscription,
  toSubscriptionSummary,
  unixSecondsToIso,
} from "@/lib/stripe-subscription";

// Webhook(app/api/billing/stripe/webhook)・同期(app/api/billing/stripe/sync)・
// 解約(app/api/billing/stripe/cancellation)の3経路が共通で使う、Stripe
// SubscriptionをAnzdropのプラン状態へ落とし込む純粋関数。プラン判定の唯一の
// 情報源になるため、境界(未知のPrice ID・アイテム欠落・中間ステータス)を
// ここで固定しておく。

const PRICE_STANDARD = "price_test_standard";
const PRICE_PREMIUM = "price_test_premium";

const fakeEnv = {
  STRIPE_PRICE_ID_STANDARD: PRICE_STANDARD,
  STRIPE_PRICE_ID_PREMIUM: PRICE_PREMIUM,
} as unknown as CloudflareEnv;

function subscription(
  overrides: {
    status?: Stripe.Subscription.Status;
    cancelAtPeriodEnd?: boolean;
    priceId?: string | null;
    periodEndUnix?: number | null;
    items?: unknown[];
  } = {}
): Stripe.Subscription {
  const {
    status = "active",
    cancelAtPeriodEnd = false,
    priceId = PRICE_STANDARD,
    periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    items,
  } = overrides;

  const data =
    items ??
    [
      {
        ...(periodEndUnix === null
          ? {}
          : { current_period_end: periodEndUnix }),
        ...(priceId === null ? {} : { price: { id: priceId } }),
      },
    ];

  return {
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    items: { data },
  } as unknown as Stripe.Subscription;
}

describe("unixSecondsToIso", () => {
  it("converts a unix-seconds timestamp to an ISO-8601 string in UTC", () => {
    // 2024-01-02T03:04:05Z
    expect(unixSecondsToIso(1704164645)).toBe("2024-01-02T03:04:05.000Z");
  });

  it("is the inverse of Date.getTime()/1000 for whole seconds", () => {
    const seconds = 1_800_000_000;
    expect(new Date(unixSecondsToIso(seconds)).getTime()).toBe(seconds * 1000);
  });
});

describe("getSubscriptionPeriodEnd", () => {
  it("returns the first item's current_period_end", () => {
    const end = 1_900_000_000;
    expect(getSubscriptionPeriodEnd(subscription({ periodEndUnix: end }))).toBe(
      end
    );
  });

  it("ignores later items and only reads the first (this app uses one item per subscription)", () => {
    const sub = subscription({
      items: [
        { current_period_end: 111, price: { id: PRICE_STANDARD } },
        { current_period_end: 999, price: { id: PRICE_PREMIUM } },
      ],
    });
    expect(getSubscriptionPeriodEnd(sub)).toBe(111);
  });

  it("returns null when the subscription has no items", () => {
    expect(getSubscriptionPeriodEnd(subscription({ items: [] }))).toBeNull();
  });

  it("returns null when the first item has no current_period_end", () => {
    expect(
      getSubscriptionPeriodEnd(subscription({ periodEndUnix: null }))
    ).toBeNull();
  });
});

describe("planFromSubscription", () => {
  it("maps the standard price id to the standard plan", () => {
    expect(
      planFromSubscription(subscription({ priceId: PRICE_STANDARD }), fakeEnv)
    ).toBe("standard");
  });

  it("maps the premium price id to the premium plan", () => {
    expect(
      planFromSubscription(subscription({ priceId: PRICE_PREMIUM }), fakeEnv)
    ).toBe("premium");
  });

  it("returns null for an unrecognized price id (defensive: do not activate an unknown plan)", () => {
    expect(
      planFromSubscription(
        subscription({ priceId: "price_someone_elses" }),
        fakeEnv
      )
    ).toBeNull();
  });

  it("returns null when the first item carries no price", () => {
    expect(
      planFromSubscription(subscription({ priceId: null }), fakeEnv)
    ).toBeNull();
  });

  it("returns null when the subscription has no items at all", () => {
    expect(
      planFromSubscription(subscription({ items: [] }), fakeEnv)
    ).toBeNull();
  });
});

describe("isActiveSubscriptionStatus", () => {
  it("is true only for active and trialing", () => {
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("trialing")).toBe(true);
  });

  it("is false for every non-paying status", () => {
    for (const status of [
      "past_due",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "canceled",
      "paused",
    ] as Stripe.Subscription.Status[]) {
      expect(isActiveSubscriptionStatus(status)).toBe(false);
    }
  });
});

describe("isDeadSubscriptionStatus", () => {
  it("is true only for the terminal statuses that never come back", () => {
    expect(isDeadSubscriptionStatus("canceled")).toBe(true);
    expect(isDeadSubscriptionStatus("incomplete_expired")).toBe(true);
    expect(isDeadSubscriptionStatus("unpaid")).toBe(true);
  });

  it("is false for active/trialing", () => {
    expect(isDeadSubscriptionStatus("active")).toBe(false);
    expect(isDeadSubscriptionStatus("trialing")).toBe(false);
  });

  it("is false for the recoverable intermediate statuses (past_due, incomplete)", () => {
    // past_due(更新 dunning 中)と incomplete(初回未確定)は、まだ回復して
    // active になりうる。ここを dead に含めると回復前に追跡を外してしまう。
    expect(isDeadSubscriptionStatus("past_due")).toBe(false);
    expect(isDeadSubscriptionStatus("incomplete")).toBe(false);
  });
});

describe("active / dead status partition", () => {
  it("no status is ever both active and dead", () => {
    for (const status of [
      "active",
      "trialing",
      "past_due",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "canceled",
      "paused",
    ] as Stripe.Subscription.Status[]) {
      expect(
        isActiveSubscriptionStatus(status) && isDeadSubscriptionStatus(status)
      ).toBe(false);
    }
  });

  it("past_due and incomplete are neither active nor dead (they are the 'wait and see' bucket)", () => {
    for (const status of [
      "past_due",
      "incomplete",
    ] as Stripe.Subscription.Status[]) {
      expect(isActiveSubscriptionStatus(status)).toBe(false);
      expect(isDeadSubscriptionStatus(status)).toBe(false);
    }
  });
});

describe("toSubscriptionSummary", () => {
  it("summarizes an auto-renewing subscription as state 'active' with the period end", () => {
    const periodEndUnix = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
    expect(
      toSubscriptionSummary(
        subscription({
          status: "active",
          cancelAtPeriodEnd: false,
          periodEndUnix,
        })
      )
    ).toEqual({
      state: "active",
      currentPeriodEnd: unixSecondsToIso(periodEndUnix),
    });
  });

  it("summarizes a subscription set to cancel at period end as state 'canceling'", () => {
    const summary = toSubscriptionSummary(
      subscription({ status: "active", cancelAtPeriodEnd: true })
    );
    expect(summary?.state).toBe("canceling");
  });

  it("also summarizes a trialing subscription (it is still a managed, paying-track subscription)", () => {
    const summary = toSubscriptionSummary(
      subscription({ status: "trialing", cancelAtPeriodEnd: false })
    );
    expect(summary?.state).toBe("active");
  });

  it("returns currentPeriodEnd: null when the subscription has no period end yet", () => {
    const summary = toSubscriptionSummary(
      subscription({ status: "active", periodEndUnix: null })
    );
    expect(summary).toEqual({ state: "active", currentPeriodEnd: null });
  });

  it("summarizes a past_due subscription as state 'past_due' with currentPeriodEnd null (Stripe's current_period_end can point at the unpaid next period, so it is not a real paid-through date)", () => {
    const periodEndUnix = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60;
    expect(
      toSubscriptionSummary(
        subscription({
          status: "past_due",
          cancelAtPeriodEnd: false,
          periodEndUnix,
        })
      )
    ).toEqual({
      state: "past_due",
      currentPeriodEnd: null,
    });
  });

  it("summarizes a past_due subscription already set to cancel at period end as state 'canceling' (still no period end for past_due)", () => {
    const periodEndUnix = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60;
    expect(
      toSubscriptionSummary(
        subscription({
          status: "past_due",
          cancelAtPeriodEnd: true,
          periodEndUnix,
        })
      )
    ).toEqual({ state: "canceling", currentPeriodEnd: null });
  });

  it("returns null for not-yet-started / terminal statuses (UI then shows the contract flow, not a management block)", () => {
    for (const status of [
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "canceled",
    ] as Stripe.Subscription.Status[]) {
      expect(toSubscriptionSummary(subscription({ status }))).toBeNull();
    }
  });
});
