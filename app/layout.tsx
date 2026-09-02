import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Anzdrop",
  description: "プライベートなファイル共有サービス",
};

// nonce ベースの CSP(proxy.ts)は、SSR 時にリクエストヘッダの nonce を参照して
// スクリプトタグへ付与する。静的生成されたページにはリクエストが無く nonce を
// 注入できないため、全ページを動的レンダリングにする(GitHub issue #64)。
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-paper text-ink font-sans">
        {children}
      </body>
    </html>
  );
}