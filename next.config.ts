import os from "node:os";
import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// ローカルD1/R2の永続化先をプロジェクト外(OS一時ディレクトリ)に置く。
// .wrangler/state をプロジェクト内に置くと、その定期的な書き込みを
// Turbopackのファイル監視が変更として検知し続け、再コンパイルのたびに
// 既知のTurbopackパニック("Next.js package not found")を踏んで、
// クライアントへ無限にフルリロードを送り続けてしまうため。
initOpenNextCloudflareForDev({
  persist: {
    path: path.join(os.tmpdir(), "anzdrop-wrangler-state"),
  },
});

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` を返さない(不要な実装情報の露出を避ける。issue #64)。
  poweredByHeader: false,
  // lib/account/wasm-argon2/*.wasm を静的importするため(next dev --webpack用)。
  //
  // webpackのexperiments.asyncWebAssemblyも試したが、Next.jsの開発モードは
  // リクエストごとにモジュールを再評価すること(Fast Refresh用の仕組み)があり、
  // その際JS側の状態(wasm-interface.tsのWeakMapなど)だけがリセットされ、
  // WASM Instance自体(線形メモリの状態)は使い回されてしまう食い違いが起き、
  // 開発時に不安定になった。専用ローダーでdata: URI文字列に変換し、呼び出しの
  // たびにWebAssembly.compile()し直して毎回フレッシュなInstanceを使うことで
  // この食い違いを避ける(本番のCloudflare Workersでは動的コンパイルが
  // 禁止されているためこの経路は通らず、turbopack.rules経由の静的wasmモジュール
  // を使う経路になる。詳細はlib/account/wasm-argon2/wasm-interface.tsを参照)。
  webpack(config) {
    config.module.rules.push({
      test: /\.wasm$/,
      type: "javascript/auto",
      use: [{ loader: path.resolve("./scripts/wasm-base64-loader.cjs") }],
    });
    return config;
  },
  // `next build`(このプロジェクトではTurbopackがデフォルト)向けの同等設定。
  // "wasm"は.wasmを実際に別ファイルとしてバンドルに含め、Cloudflare Workers
  // 本番でも静的wasmモジュールとして扱われるようにする(詳細は
  // lib/account/wasm-argon2/wasm-interface.tsのコメントを参照)。
  turbopack: {
    rules: {
      "*.wasm": {
        type: "wasm",
      },
    },
  },
  // 未使用の @vercel/og(OG画像の動的生成ライブラリ)をWorkerのバンドルから外す。
  //
  // このアプリはOG画像を動的生成していない(ImageResponse・next/og・
  // opengraph-image のいずれも使っていない)が、Next.jsのファイルトレース
  // (.next/server/**/*.nft.json)に @vercel/og 一式が入ってしまう。観測時点で
  // これが現れていたのは .wasm を静的importしているルート、すなわち
  // lib/account/wasm-argon2 経由の /api/account/{login,signup,recover} だけ
  // だったが、混入経路を特定せずに済むよう全ルートを対象に除外する。
  // 除外しないと resvg.wasm(約1.3MiB)などが不要にバンドルされ、Cloudflare
  // Workers のスクリプトサイズ上限(gzip 3MiB)を超えてデプロイが失敗する。
  //
  // @opennextjs/cloudflare は「トレースに @vercel/og が現れるか」でライブラリの
  // 使用有無を判定し、未使用ならエッジ版のimportをthrowするシムに差し替えて
  // バンドルから除外する。ここでトレースから除いておくことでその経路に乗せる。
  // 将来OG画像の動的生成を使う場合は、この除外を外す必要がある。
  outputFileTracingExcludes: {
    "**": ["./node_modules/next/dist/compiled/@vercel/og/**/*"],
  },
};

export default nextConfig;