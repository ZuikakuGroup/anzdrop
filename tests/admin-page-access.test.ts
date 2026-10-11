import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ACCESS_PATH, canRenderAdminPage, isAdminPage } from "@/lib/adminPageAccess";
import { app } from "@/server/app";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token !== "valid-access-token") throw new Error("private verification detail");
    return { payload: { email: "admin@example.com" } };
  }),
}));
const env = { CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com", CF_ACCESS_AUD: "test", DEPLOYMENT_ENV: "production" } as unknown as CloudflareEnv;
const binding = { fetch: async (request: Request) => app.fetch(request, env) };
afterEach(() => { vi.unstubAllEnvs(); });

describe("admin page authentication boundary", () => {
  it.each(["/admin", "/admin/accounts", "/admin/contacts", "/admin/"])("protects %s", path => expect(isAdminPage(path)).toBe(true));
  it.each(["/administrator", "/api/admin/accounts", "/contact"])("does not treat %s as an admin page", path => expect(isAdminPage(path)).toBe(false));
  it("accepts a verified Access token without returning the identity", async () => {
    const request = new Request("https://anzdrop.com/admin", { headers: { "Cf-Access-Jwt-Assertion": "valid-access-token" } });
    expect(await canRenderAdminPage(request, binding)).toBe(true);
    const response = await binding.fetch(new Request(`https://anzdrop.com${ADMIN_ACCESS_PATH}`, { headers: request.headers }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("preserves the Access cookie authentication path", async () => {
    expect(await canRenderAdminPage(new Request("https://anzdrop.com/admin", { headers: { Cookie: "CF_Authorization=valid-access-token" } }), binding)).toBe(true);
  });
  it.each([undefined, "invalid-access-token"])("denies missing or invalid credentials: %s", async token => {
    const headers: Record<string, string> = token ? { "Cf-Access-Jwt-Assertion": token } : {};
    expect(await canRenderAdminPage(new Request("https://anzdrop.com/admin", { headers }), binding)).toBe(false);
    const response = await binding.fetch(new Request(`https://anzdrop.com${ADMIN_ACCESS_PATH}`, { headers }));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private");
  });
  it.each([200, 302, 401, 404, 500])("fails closed on an unexpected response %s", async status => {
    expect(await canRenderAdminPage(new Request("https://anzdrop.com/admin"), { fetch: async () => new Response(null, { status }) })).toBe(false);
  });
  it("fails closed if the binding is missing or unavailable", async () => {
    const request = new Request("https://anzdrop.com/admin");
    expect(await canRenderAdminPage(request)).toBe(false);
    expect(await canRenderAdminPage(request, { fetch: async () => { throw new Error("private network error"); } })).toBe(false);
  });
  it("never enables local bypass in production, even with development flags", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_ADMIN_BYPASS", "true");
    const productionBinding = { fetch: async (request: Request) => app.fetch(request, { ...env, DEPLOYMENT_ENV: "production", LOCAL_DEVELOPMENT: "true", LOCAL_ADMIN_BYPASS: "true" }) };
    expect(await canRenderAdminPage(new Request("http://localhost/admin"), productionBinding)).toBe(false);
  });
  it("allows explicit local development only on a loopback host", async () => {
    const localBinding = { fetch: async (request: Request) => app.fetch(request, { ...env, DEPLOYMENT_ENV: "", LOCAL_DEVELOPMENT: "true", LOCAL_ADMIN_BYPASS: "true" }) };
    expect(await canRenderAdminPage(new Request("http://localhost:3000/admin"), localBinding)).toBe(true);
    expect(await canRenderAdminPage(new Request("https://anzdrop.com/admin"), localBinding)).toBe(false);
  });
});
