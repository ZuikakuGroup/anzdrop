import type { Metadata } from "next";

// アカウント関連ページ(/mypage 配下すべて。ログイン・サインアップ・
// パスワード再設定・プラン確認・アカウント概要)は検索結果に出す意味がなく、
// URL にアカウント状態が絡むため noindex にする。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MypageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
