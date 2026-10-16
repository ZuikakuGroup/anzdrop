import Stripe from "stripe";

export function createStripeClient(env: CloudflareEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

export function stripeErrorStatus(error: unknown): unknown {
  return error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
}
