import path from "node:path";
import type { NextConfig } from "next";

const repositoryRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  // 独自パスへ出すことで、既存アプリの /_next/ アセットと衝突させない。
  // home-worker.ts が内部で /_next/ に戻して OpenNext の assets binding へ渡す。
  assetPrefix:
    process.env.NODE_ENV === "development" ? undefined : "/_home-next",
  images: {
    remotePatterns: [new URL("https://images.microcms-assets.io/**")],
  },
  outputFileTracingRoot: repositoryRoot,
  poweredByHeader: false,
  turbopack: {
    // トップページのUI・暗号化クライアントはリポジトリ直下で共有する。
    root: repositoryRoot,
    rules: {
      "*.wasm": {
        type: "wasm",
      },
    },
  },
  outputFileTracingExcludes: {
    "**": ["./node_modules/next/dist/compiled/@vercel/og/**/*"],
  },
};

export default nextConfig;
