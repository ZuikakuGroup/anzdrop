import { buildStaticSecurityHeaders, buildContentSecurityPolicy, isLoopbackHost } from "./lib/securityHeaders";
import { NextResponse, type NextRequest } from "next/server";

// 全ルートにセキュリティレスポンスヘッダを付与する(GitHub issue #64)。
//
// ダウンロード画面(components/download/DownloadPage.tsx)は E2E 復号鍵を
// URL フラグメントから読み取ってメモリに保持し、パスワード・復号済みファイルも
// この origin 上に存在する。ここで XSS が1つでも成立すると E2E 暗号化の前提が
// 丸ごと崩れるため、nonce ベースの厳格な CSP を多層防御の中心に据える。
//
// nonce はリクエストごとに生成し、レスポンスの Content-Security-Policy と
// x-nonce リクエストヘッダの両方に載せる。Next.js は SSR 時にリクエスト側の
// CSP ヘッダから nonce を取り出し、フレームワークスクリプト・ページバンドル・
// next/script(Turnstile ローダ)へ自動で付与する。nonce を使うにはページが
// 動的レンダリングされている必要があるため、app/layout.tsx で
// `export const dynamic = "force-dynamic"` を宣言している。
//
// この proxy は @opennextjs/cloudflare 上では「Node.js middleware」として
// バンドルされる(OpenNext 側では実験的・非公式サポート扱い)。本番相当の
// プレビューでの nonce 付与のスモーク確認と、OpenNext / Next の更新時の
// リグレッション確認を運用上のチェックリストに入れておくこと(docs/deployment.md)。

// enforce する前に観測だけしたい場合は環境変数 CSP_REPORT_ONLY=1 を設定する。
// この場合レスポンスは Content-Security-Policy-Report-Only になり、違反は
// ブラウザの devtools に出るだけでブロックされない(ロールアウト時の安全弁)。
function isCspReportOnly(): boolean {
  const value = process.env.CSP_REPORT_ONLY;
  return value === "1" || value === "true";
}

function isProductionDeployment(): boolean {
  return process.env.DEPLOYMENT_ENV === "production";
}


export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV === "development";
  const isProduction = isProductionDeployment();
  // Next.js 公式の nonce レシピと同じ生成方法(base64)。Next の CSP パーサが
  // 期待する `'nonce-<value>'` 形式に確実に合致させる。
  const nonce = btoa(crypto.randomUUID());
  const skipUpgradeInsecureRequests =
    process.env.WEB_AUDIT === "true" && isLoopbackHost(request.nextUrl.hostname);
  const csp = buildContentSecurityPolicy(nonce, isDev, { skipUpgradeInsecureRequests });
  const responseCspHeader = isCspReportOnly()
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // リクエスト側は常に enforce 名で渡す。Next.js はこのヘッダから nonce を
  // 取り出してスクリプトへ付与する(report-only 中も nonce は必要)。
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set(responseCspHeader, csp);
  for (const [key, value] of Object.entries(
    buildStaticSecurityHeaders(isProduction)
  )) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    // 静的アセットと画像最適化・favicon を除く全リクエスト。
    // next/link のプリフェッチ(RSC ペイロード。実行されない)も対象外にする。
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
