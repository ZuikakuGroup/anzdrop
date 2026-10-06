import type { Metadata } from "next";
import { siteUrl } from "@/lib/blog/site";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import "./globals.css";

const siteDescription = "プライベートなファイル共有サービス";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  ...pageMetadata({
    title: "Anzdrop",
    description: siteDescription,
    path: "/",
  }),
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
      className="h-full antialiased"
    >
      <body className="min-h-screen bg-paper text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
