import type { Metadata } from "next";
import PrivacyPage from "@/components/legal/PrivacyPage";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Anzdrop",
  description: "Anzdropにおける情報の取扱いについて定めたプライバシーポリシーです。",
};

export default function Page() {
  return <PrivacyPage />;
}
