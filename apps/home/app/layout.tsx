import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anzdrop",
  description: "プライベートなファイル共有サービス",
};

// nonce CSP はリクエストごとに生成するため、トップページもSSRを維持する。
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-screen bg-paper text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
