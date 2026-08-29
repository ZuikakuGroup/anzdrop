import { loadStripe, type Stripe } from "@stripe/stripe-js";

export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

// loadStripe()はStripe.jsのスクリプトタグを挿入する。重複挿入を避けるため、
// アプリ全体で一度だけ呼び出した結果のPromiseを使い回す(Stripe公式の推奨パターン)。
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    // 公開可能キー未設定(環境変数の設定漏れ)のままloadStripe()を呼ぶと、
    // Stripe.js側で例外になりPromiseがrejectされてしまう。呼び出し側は
    // 既に「stripeがnull」の状態を正常系として扱っているため、その形に揃える。
    stripePromise = STRIPE_PUBLISHABLE_KEY
      ? loadStripe(STRIPE_PUBLISHABLE_KEY)
      : Promise.resolve(null);
  }

  return stripePromise;
}
