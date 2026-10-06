import type { Metadata } from "next";
import AboutPage from "@/components/about/AboutPage";
import { pageMetadata } from "@/lib/seo/pageMetadata";

export const metadata: Metadata = pageMetadata({
  title: "Anzdropとは | Anzdrop",
  description: "Anzdropの仕組み、エンドツーエンド暗号化、よくある質問について紹介します。",
  path: "/about",
});

export default function Page() {
  return <AboutPage />;
}
