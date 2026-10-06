import type { Metadata } from "next";
import PricingPage from "@/components/pricing/PricingPage";
import { pageMetadata } from "@/lib/seo/pageMetadata";

export const metadata: Metadata = pageMetadata({
  title: "料金プラン | Anzdrop",
  description: "Anzdropの無料プランと有料プランの料金・上限を比較できます。",
  path: "/pricing",
});

export default function Page() {
  return <PricingPage />;
}
