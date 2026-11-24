import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import * as access from "@/lib/access";
import { ADMIN_ACCESS_PATH } from "@/lib/adminPageAccess";

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
function environment() {
  const first = vi.fn().mockResolvedValue({ ok: 1 });
  const prepare = vi.fn().mockReturnValue({ first });
  const head = vi.fn().mockResolvedValue(null);
  return { env: { DB: { prepare }, FILES_BUCKET: { head } } as unknown as CloudflareEnv, first, prepare, head };
}
afterEach(() => vi.restoreAllMocks());
describe("admin readiness HTTP boundary", () => {
  it("records unexpected Hono exceptions without disclosing the request or error", async () => {
    vi.spyOn(access, "verifyAccessJwt").mockRejectedValue(new Error("secret-token"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = environment();
    const response = await app.fetch(new Request(`https://example.com${ADMIN_ACCESS_PATH}?token=secret-token`), env, ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "サーバー内部でエラーが発生しました" });
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: "api_request", errorKind: "exception", status: 500 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
  });
  it("denies unauthenticated requests before probing dependencies", async () => {
    vi.spyOn(access, "verifyAccessJwt").mockResolvedValue(null);
    const { env, prepare, head } = environment();
    const response = await app.fetch(new Request("https://example.com/api/admin/health"), env, ctx);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prepare).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });
  it.each([false, true])("returns dependency status with no-store, failure=%s", async failed => {
    vi.spyOn(access, "verifyAccessJwt").mockResolvedValue({ email: "admin@example.com" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, first } = environment();
    if (failed) first.mockRejectedValue(new Error("secret SQL token"));
    const response = await app.fetch(new Request("https://example.com/api/admin/health", { headers: { "X-Request-ID": "secret" } }), env, ctx);
    expect(response.status).toBe(failed ? 503 : 200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ success: !failed, checks: { d1: failed ? "error" : "ok", r2: "ok" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    if (failed) expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "api_request", operation: "GET /api/admin/health", status: 503 }));
  });
});
