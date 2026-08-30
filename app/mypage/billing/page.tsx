import BillingPage from "@/components/billing/BillingPage";

type PageProps = {
  searchParams: Promise<{
    payment_intent_client_secret?: string | string[];
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { payment_intent_client_secret: paymentIntentClientSecret } =
    await searchParams;

  // 同じキーが複数回指定されると配列になる。retrievePaymentIntent() は
  // 文字列しか受け取らないため、先頭の値だけを使う。
  const clientSecret = Array.isArray(paymentIntentClientSecret)
    ? paymentIntentClientSecret[0]
    : paymentIntentClientSecret;

  return <BillingPage initialPaymentIntentClientSecret={clientSecret} />;
}
