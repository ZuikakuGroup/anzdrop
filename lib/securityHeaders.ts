export function buildStaticSecurityHeaders(
  isProduction: boolean
): Record<string, string> {
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

  // HSTS は HTTPS が保証される明示的な本番デプロイでのみ付与する。
  if (isProduction) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  { skipUpgradeInsecureRequests = false }: { skipUpgradeInsecureRequests?: boolean } = {},
): string {
  // strict-dynamic により、nonce を持つスクリプト(Astro のバンドル、外部スクリプト
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
    // 署名付き UploadPart URL の送信先。アカウント ID は wrangler.jsonc と同じ
    // 公開値を指定し、R2 の他アカウントには接続を許可しない。
    "https://2a1ab8b6a9b36f7f0c4292dce044e0c4.r2.cloudflarestorage.com",
    // 開発時の HMR(Turbopack の WebSocket)。
    isDev ? "ws:" : "",
    isDev ? "wss:" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // React のインラインスタイル(style 属性)と コンポーネントが挿入する <style> の
    // ため style は unsafe-inline を許可する。スタイル注入はスクリプト実行に
    // 比べ危険度が低く、厳格な CSP でも一般的に許容される。
    `style-src 'self' 'unsafe-inline'`,
    // プレビュー・QR は blob:/data: を使う。
    `img-src 'self' blob: data: https://images.microcms-assets.io`,
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
  ];

  // ローカル HTTP 上の SEO/Lighthouse 監査では、Chrome が HTTPS へアップグレード
  // して interstitial になるため付けない。WEB_AUDIT=true かつループバック Host
  // のときだけ外し、本番 Host では誤設定があっても維持する。
  if (!skipUpgradeInsecureRequests) {
    directives.push(`upgrade-insecure-requests`);
  }

  return directives.join("; ");
}
