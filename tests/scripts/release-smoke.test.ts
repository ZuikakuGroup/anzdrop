import { expect, it, vi } from "vitest";
import { smokeRelease } from "@/scripts/release-smoke.mjs";

const origin = "https://staging.example.com";
function responseFor(path: string) {
  if (path === "/") return new Response('<html><script src="/_public-astro/release.js"></script></html>', { headers: { "content-type": "text/html" } });
  if (path === "/_public-astro/release.js") return new Response("export default {}", { headers: { "content-type": "text/javascript" } });
  if (path === "/api/account/me") return Response.json({ success: false }, { status: 401 });
  return new Response(null, { status: 404 });
}
it("only reads the expected origin and refuses redirects before sending credentials elsewhere", async () => {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
    requests.push(url);
    expect(options.redirect).toBe("manual");
    expect(options.method).toBeUndefined();
    return responseFor(url.pathname);
  });
  await smokeRelease(origin, { expectedOrigin: origin, fetcher, headers: { "CF-Access-Client-Id": "synthetic" } });
  expect(requests.map(url => url.pathname)).toEqual(["/", "/_public-astro/release.js", "/api/account/me", "/__internal/admin-auth"]);
  expect(requests.every(url => url.origin === origin)).toBe(true);
  await expect(smokeRelease("https://anzdrop.com", { expectedOrigin: origin, fetcher })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(4);
  await expect(smokeRelease(origin, { expectedOrigin: origin, fetcher: async () => new Response(null, { status: 302, headers: { Location: "https://other.example.com" } }) })).rejects.toThrow("redirected");
});
it.each(["missing-assets", "asset-html", "api-fallback", "exposed-internal"])("fails a release with %s", async failure => {
  await expect(smokeRelease(origin, { expectedOrigin: origin, fetcher: async (url: URL) => {
    if (failure === "missing-assets" && url.pathname === "/") return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    if (failure === "asset-html" && url.pathname.endsWith(".js")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    if (failure === "api-fallback" && url.pathname === "/api/account/me") return new Response("<html>fallback</html>");
    if (failure === "exposed-internal" && url.pathname.startsWith("/__internal")) return new Response("exposed");
    return responseFor(url.pathname);
  } })).rejects.toThrow();
});
