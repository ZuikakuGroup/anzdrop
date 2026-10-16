import Stripe from "stripe";

export function createStripeClient(env: CloudflareEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

// Only numeric SDK status codes can identify a missing Stripe resource (404).
export function stripeErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    return typeof error.statusCode === "number" ? error.statusCode : undefined;
  }
  return undefined;
}
