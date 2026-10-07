import { describe, expect, it, vi } from "vitest";
import router from "@/workers/router";
import { isHomeRequest, isPublicRequest } from "@/workers/router/routing";

describe("トップページWorkerのルーティング", () => {
  it.each(["/_home-next/_next/static/chunk.js"])(
    "%s をトップページWorkerへ送る",
    (pathname) => {
      expect(isHomeRequest(pathname)).toBe(true);
    }
  );

  it.each(["/api/upload/start", "/_next/static/chunk.js", "/mypage"])(
    "%s は既存アプリWorkerへ送る",
    (pathname) => {
      expect(isHomeRequest(pathname)).toBe(false);
    }
  );
});

describe("公開ページWorkerのルーティング", () => {
  it.each(["/", "/mypage", "/mypage/", "/mypage/security", "/mypage/billing", "/d/share", "/about", "/about/", "/pricing", "/legal/privacy", "/lp/secure-file-sharing", "/blog", "/blog/", "/blog/article", "/blog/categories/topic", "/blog/authors/writer", "/blog/tags/topic", "/robots.txt", "/sitemap.xml", "/_public-astro/main.js"])("%s はAstroへ送る", pathname => {
    expect(isPublicRequest(pathname)).toBe(true);
    expect(isHomeRequest(pathname)).toBe(false);
  });
  it.each(["/api/account/login", "/api/me", "/mypage-secret", "/d-secret", "/admin", "/contact", "/report", "/about-secret", "/blogger", "/_next/static/chunk.js"])("%s はAstroへ送らない", pathname => {
    expect(isPublicRequest(pathname)).toBe(false);
  });
  it.each([["/", "PUBLIC"], ["/blog/post", "PUBLIC"], ["/api/account/login", "APP"]] as const)("%s のRequestとResponseをそのまま渡す", async (pathname, target) => {
    const request = new Request(`https://anzdrop.com${pathname}`, { method: "POST", headers: { Cookie: "session=test" }, body: "opaque body" });
    const response = new Response("opaque response", { headers: { "Set-Cookie": "session=test" } });
    const env = { HOME: { fetch: vi.fn(() => response) }, PUBLIC: { fetch: vi.fn(() => response) }, APP: { fetch: vi.fn(() => response) } };
    expect(await router.fetch(request, env)).toBe(response);
    expect(env[target].fetch).toHaveBeenCalledExactlyOnceWith(request);
    expect(await request.text()).toBe("opaque body");
    for (const key of ["HOME", "PUBLIC", "APP"] as const) if (key !== target) expect(env[key].fetch).not.toHaveBeenCalled();
  });
});
