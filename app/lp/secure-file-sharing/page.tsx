import type { Metadata } from "next";
import SecureFileSharingLandingPage from "@/components/landing/SecureFileSharingLandingPage";

export const metadata: Metadata = {
  title: "ファイルは、送る前に暗号化。登録不要のファイル共有 | Anzdrop",
  description:
    "登録不要でファイルを選び、ブラウザ内で暗号化してリンクで共有。通常の共有では復号鍵をサーバーに送らず、無料プランは1ファイル最大5GBまで使えます。",
};

export default function Page() {
  return <SecureFileSharingLandingPage />;
}
