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

function buildStaticSecurityHeaders(isDev: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    // frame-ancestors 'none' と重複するが、CSP 非対応の古いブラウザ向けに併記する。
    "X-Frame-Options": "DENY",
    // 利用者アップロードのバイト列を自 origin から配信する /api/file/[fileId] を
    // 含め、Content-Type の推測(sniffing)を全ルートで禁止する。
    "X-Content-Type-Options": "nosniff",
    // 復号鍵はフラグメントなので Referer には乗らないが、shareId を含むパスの
    // 流出も避けるため Referer 自体を送らない。
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self "https://js.stripe.com")',
  };

  // HSTS は HTTPS 前提。開発(http://localhost)では意味がなく紛らわしいので付けない。
  if (!isDev) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  // strict-dynamic により、nonce を持つスクリプト(Next のバンドル、next/script
  // 経由の Turnstile ローダ、@stripe/stripe-js のローダ)が動的に読み込む子
  // スクリプトは、追加のホスト許可なしで実行できる。末尾のホスト列挙は
  // strict-dynamic 非対応の古いブラウザ向けのフォールバック。
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://js.stripe.com",
    "https://m.stripe.network",
    // 開発時は React が eval でサーバーエラースタックを復元するため必要。
    isDev ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const connectSrc = [
    "'self'",
    "https://challenges.cloudflare.com",
    "https://api.stripe.com",
    "https://m.stripe.network",
    "https://r.stripe.com",
    // 開発時の HMR(Turbopack の WebSocket)。
    isDev ? "ws:" : "",
    isDev ? "wss:" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // React のインラインスタイル(style 属性)と next/font が挿入する <style> の
    // ため style は unsafe-inline を許可する。スタイル注入はスクリプト実行に
    // 比べ危険度が低く、厳格な CSP でも一般的に許容される。
    `style-src 'self' 'unsafe-inline'`,
    // プレビュー・QR は blob:/data: を使う。
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    // Turnstile / Stripe の iframe。
    `frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://m.stripe.network`,
    // プレビュー動画・音声の blob:。
    `media-src 'self' blob:`,
    // fflate の一括 ZIP 生成は blob URL からワーカーを起動する。将来の
    // ダウンロード用 Service Worker(自 origin)も許可する。
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV === "development";
  // Next.js 公式の nonce レシピと同じ生成方法(base64)。Next の CSP パーサが
  // 期待する `'nonce-<value>'` 形式に確実に合致させる。
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce, isDev);
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
    buildStaticSecurityHeaders(isDev)
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
