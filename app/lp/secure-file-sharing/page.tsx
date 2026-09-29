import type { Metadata } from "next";
import SecureFileSharingLandingPage from "@/components/landing/SecureFileSharingLandingPage";

export const metadata: Metadata = {
  title: "安全なファイル共有を、登録不要ですぐに | Anzdrop",
  description:
    "ファイルをブラウザ内で暗号化してから共有。復号鍵はサーバーに送られません。登録不要、無料で最大5GBまで使えるAnzdropのファイル共有サービス。",
};

export default function Page() {
  return <SecureFileSharingLandingPage />;
}
