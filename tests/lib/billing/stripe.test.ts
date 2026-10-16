import { describe, expect, it } from "vitest";
import { stripeErrorStatus } from "@/lib/billing/stripe";

describe("Stripe error status", () => {
  it.each([400, 404, 429, 500, 503])("preserves a numeric SDK status (%s)", statusCode => {
    expect(stripeErrorStatus(Object.assign(new Error("Stripe request failed"), { statusCode }))).toBe(statusCode);
  });

  it.each([null, undefined, "404", 404, new Error("Network error"), {}, { statusCode: "404" }, { statusCode: null }])(
    "does not mistake non-SDK errors or malformed status codes for a missing resource (%j)", error => {
      expect(stripeErrorStatus(error)).toBeUndefined();
    }
  );
});
