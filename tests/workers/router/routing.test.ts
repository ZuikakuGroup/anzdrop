import { describe, expect, it, vi } from "vitest";
import router from "@/workers/router";
import { isApiRequest, isInternalRequest } from "@/workers/router/routing";

describe("three-Worker routing", () => {
  it.each(["/api", "/api/", "/api/upload/start", "/api/admin/accounts"])("sends %s to Hono unchanged", async path => {
    const request = new Request(`https://anzdrop.com${path}`, { method: "POST", headers: { Cookie: "session=example" }, body: "body" });
    const response = new Response("api");
    const env = { APP: { fetch: vi.fn().mockResolvedValue(response) }, PUBLIC: { fetch: vi.fn() } };
    expect(await router.fetch(request, env)).toBe(response);
    expect(env.APP.fetch).toHaveBeenCalledWith(request);
    expect(env.PUBLIC.fetch).not.toHaveBeenCalled();
  });
  it.each(["/", "/contact", "/report/rights", "/admin/accounts", "/mypage", "/d/share", "/blog/post", "/_public-astro/app.js", "/unknown", "/api-secret"])("sends %s to Astro", async path => {
    const env = { APP: { fetch: vi.fn() }, PUBLIC: { fetch: vi.fn().mockResolvedValue(new Response("html")) } };
    const request = new Request(`https://anzdrop.com${path}`);
    await router.fetch(request, env);
    expect(env.PUBLIC.fetch).toHaveBeenCalledWith(request);
    expect(env.APP.fetch).not.toHaveBeenCalled();
    expect(isApiRequest(path)).toBe(false);
  });
  it.each(["/__internal", "/__internal/admin/access", "/__internal/admin/access/"])("blocks %s before reaching either Worker", async path => {
    const env = { APP: { fetch: vi.fn() }, PUBLIC: { fetch: vi.fn() } };
    const response = await router.fetch(new Request(`https://anzdrop.com${path}`), env);
    expect(isInternalRequest(path)).toBe(true);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(env.APP.fetch).not.toHaveBeenCalled();
    expect(env.PUBLIC.fetch).not.toHaveBeenCalled();
  });
});
