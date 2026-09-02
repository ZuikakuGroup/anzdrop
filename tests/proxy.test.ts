import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function runProxy(pathname = "/") {
  return proxy(new NextRequest(`https://anzdrop.example${pathname}`));
}

function cspOf(response: ReturnType<typeof proxy>): string {
  const csp =
    response.headers.get("Content-Security-Policy") ??
    response.headers.get("Content-Security-Policy-Report-Only");
  if (!csp) {
    throw new Error("Content-Security-Policy header is missing");
  }
  return csp;
}

function nonceOf(csp: string): string | undefined {
  return csp.match(/'nonce-([^']+)'/)?.[1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — CSP", () => {
  it("nonce ベースの厳格な CSP を付与する", () => {
    const csp = cspOf(runProxy());

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
    // script は unsafe-inline を許可しない(style は許可する)。
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it("nonce は Next.js が CSP ヘッダから抽出できる形式で、リクエストごとに変わる", () => {
    const first = cspOf(runProxy());
    const second = cspOf(runProxy());

    const nonce = nonceOf(first);
    expect(nonce).toBeTruthy();
    // Next.js の CSP_NONCE_SOURCE_REGEX と同等: base64 文字種のみ。
    expect(`'nonce-${nonce}'`).toMatch(/^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/);
    expect(nonce).not.toBe(nonceOf(second));
  });

  it("同じ nonce を CSP レスポンスヘッダとリクエストヘッダ(x-nonce)の両方へ載せる", () => {
    // NextResponse.next({ request: { headers } }) は書き換えたリクエストヘッダを
    // x-middleware-request-* / x-middleware-override-headers として反映する。
    const response = runProxy();
    const cspNonce = nonceOf(cspOf(response));

    const overrides = response.headers.get("x-middleware-override-headers") ?? "";
    expect(overrides.split(",").map((h) => h.trim())).toContain("x-nonce");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(cspNonce);
    // リクエスト側 CSP は常に enforce 名(nonce 抽出に使われる)。
    expect(
      response.headers.get("x-middleware-request-content-security-policy")
    ).toContain(`'nonce-${cspNonce}'`);
  });

  it("Turnstile / Stripe / 一括ZIP(blob worker)に必要な origin を許可する", () => {
    const csp = cspOf(runProxy());

    expect(csp).toMatch(/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src[^;]*https:\/\/js\.stripe\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.stripe\.com/);
    expect(csp).toMatch(/worker-src[^;]*blob:/);
    expect(csp).toMatch(/media-src[^;]*blob:/);
  });

  it("本番では unsafe-eval / ws: を含めない", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = cspOf(runProxy());

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/connect-src[^;]*\bws:/);
  });

  it("開発では unsafe-eval と HMR 用の ws: を許可する", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = cspOf(runProxy());

    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).toMatch(/connect-src[^;]*\bws:/);
  });

  it("CSP_REPORT_ONLY=1 のときは Report-Only ヘッダで送る(enforce しない)", () => {
    vi.stubEnv("CSP_REPORT_ONLY", "1");
    const response = runProxy();

    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    const reportOnly = response.headers.get(
      "Content-Security-Policy-Report-Only"
    );
    expect(reportOnly).toContain("'strict-dynamic'");
    // report-only でもリクエスト側には enforce 名で載せて nonce を機能させる。
    expect(
      response.headers.get("x-middleware-request-content-security-policy")
    ).toContain("'nonce-");
  });
});

describe("proxy — その他のセキュリティヘッダ", () => {
  it("クリックジャッキング・sniffing・Referer 漏洩の対策ヘッダを付与する", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { headers } = runProxy();

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("開発では HSTS を付けない(http では無意味なため)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(runProxy().headers.get("Strict-Transport-Security")).toBeNull();
  });
});

describe("proxy — matcher", () => {
  it("静的アセット・画像最適化・favicon を除外し、ページと API は対象にする", async () => {
    const { unstable_doesMiddlewareMatch } = await import(
      "next/experimental/testing/server"
    );
    const matches = (url: string, headers?: Record<string, string>) =>
      unstable_doesMiddlewareMatch({
        config,
        url: `https://anzdrop.example${url}`,
        headers,
      });

    expect(matches("/")).toBe(true);
    expect(matches("/d/abc123")).toBe(true);
    expect(matches("/api/file/xyz")).toBe(true);

    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/image?url=x")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);

    // next/link のプリフェッチは対象外(missing 条件)。
    expect(matches("/pricing", { "next-router-prefetch": "1" })).toBe(false);
    expect(matches("/pricing", { purpose: "prefetch" })).toBe(false);
  });
});
