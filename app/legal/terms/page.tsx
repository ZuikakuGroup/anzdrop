import type { Metadata } from "next";
import TermsPage from "@/components/legal/TermsPage";

export const metadata: Metadata = {
  title: "利用規約 | Anzdrop",
  description: "Anzdropの利用規約です。",
};

export default function Page() {
  return <TermsPage />;
}
