import type { Metadata } from "next";
import TokushohoPage from "@/components/legal/TokushohoPage";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | Anzdrop",
  description: "Anzdropの有料プラン購入にあたっての特定商取引法に基づく表示です。",
};

export default function Page() {
  return <TokushohoPage />;
}
