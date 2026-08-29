import BillingPage from "@/components/billing/BillingPage";

type PageProps = {
  searchParams: Promise<{
    payment_intent_client_secret?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { payment_intent_client_secret: paymentIntentClientSecret } =
    await searchParams;

  return (
    <BillingPage
      initialPaymentIntentClientSecret={paymentIntentClientSecret}
    />
  );
}
