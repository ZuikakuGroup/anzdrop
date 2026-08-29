import { loadStripe, type Stripe } from "@stripe/stripe-js";

export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

// loadStripe()はStripe.jsのスクリプトタグを挿入する。重複挿入を避けるため、
// アプリ全体で一度だけ呼び出した結果のPromiseを使い回す(Stripe公式の推奨パターン)。
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }

  return stripePromise;
}
