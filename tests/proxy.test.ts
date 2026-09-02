import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function runProxy(pathname = "/") {
  return proxy(new NextRequest(`https://anzdrop.example${pathname}`));
}

function cspOf(response: ReturnType<typeof proxy>): string {
  const csp = response.headers.get("Content-Security-Policy");
  if (!csp) {
    throw new Error("Content-Security-Policy header is missing");
  }
  return csp;
}

describe("proxy — セキュリティヘッダ", () => {
  it("nonce ベースの厳格な CSP を付与する", () => {
    const csp = cspOf(runProxy());

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // script-src に nonce が含まれ、unsafe-inline は含まれない。
    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9]+'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("Turnstile と Stripe の origin を許可する", () => {
    const csp = cspOf(runProxy());

    expect(csp).toMatch(
      /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/
    );
    expect(csp).toMatch(/frame-src[^;]*https:\/\/js\.stripe\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.stripe\.com/);
  });

  it("一括 ZIP / Service Worker 用に worker-src で blob: を許可する", () => {
    expect(cspOf(runProxy())).toMatch(/worker-src[^;]*blob:/);
  });

  it("リクエストごとに異なる nonce を発行する", () => {
    const first = cspOf(runProxy());
    const second = cspOf(runProxy());

    const nonceOf = (csp: string) =>
      csp.match(/'nonce-([A-Za-z0-9]+)'/)?.[1];

    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it("クリックジャッキング・sniffing・Referer 漏洩の各対策ヘッダを付与する", () => {
    const { headers } = runProxy();

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("静的アセットと画像最適化は matcher の対象外", () => {
    const source = config.matcher[0].source;

    expect(source).toContain("_next/static");
    expect(source).toContain("_next/image");
    expect(source).toContain("favicon.ico");
  });
});
