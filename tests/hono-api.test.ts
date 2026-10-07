import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { createTestEnv, clearAllTables, insertTestAccount, stubTurnstileSuccess, type TestEnv } from "@/test/env";
import { encryptAuthSecret } from "@/lib/account/authEncryption";
import { generateTotpSecret, totpAtStep } from "@/lib/account/totp";

let env: TestEnv;
let dispose: () => Promise<void>;
let background: Promise<unknown>[] = [];
const ctx = { waitUntil: vi.fn((work: Promise<unknown>) => { background.push(work); }), passThroughOnException: vi.fn(), props: {} };
const origin = "http://localhost:3000";
function request(path: string, method = "GET", body?: unknown, cookie = "") {
  return app.fetch(new Request(`${origin}${path}`, { method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, ctx);
}
beforeAll(async () => { const handle = await createTestEnv(); env = handle.env; dispose = handle.dispose; }, 60_000);
afterAll(async () => dispose?.());
beforeEach(async () => { await clearAllTables(env); background = []; stubTurnstileSuccess(); vi.stubEnv("DEPLOYMENT_ENV", ""); vi.stubEnv("ACCOUNT_AUTH_LOCAL_ORIGIN", origin); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Hono API HTTP boundary", () => {
  it("does not issue a session until OTP succeeds and does not trust a submitted account ID", async () => {
    const account = await insertTestAccount(env);
    const secret = generateTotpSecret();
    await env.DB.prepare("INSERT INTO account_totp(account_id, encrypted_secret) VALUES (?, ?)").bind(account.accountId, await encryptAuthSecret(secret, account.accountId, "totp", env.ACCOUNT_AUTH_ENCRYPTION_KEY)).run();
    const start = await request("/api/account/login", "POST", { accountId: account.accountId, password: account.password, turnstileToken: "token" });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ next: "otp" });
    const cookies = start.headers.getSetCookie();
    expect(cookies.some(cookie => cookie.startsWith("anzdrop_session="))).toBe(false);
    const browserCookie = cookies.map(cookie => cookie.split(";")[0]).join("; ");
    const complete = await request("/api/account/login/otp", "POST", { code: await totpAtStep(secret, Math.floor(Date.now() / 30000)), accountId: "someone-else" }, browserCookie);
    expect(complete.status).toBe(200);
    const session = complete.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    const me = await request("/api/account/me", "GET", undefined, session);
    expect(await me.json()).toMatchObject({ success: true, accountId: account.accountId });
    expect((await request("/api/account/login/otp", "POST", { code: "123456" }, browserCookie)).status).toBe(403);
  });
  it("preserves signed Stripe raw JSON, including whitespace, and rejects a changed byte", async () => {
    const payload = JSON.stringify({ id: "evt_hono_raw", type: "customer.subscription.deleted", data: { object: { id: "sub_missing" } } }, null, 2) + "\n";
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
    const signature = `t=${timestamp},v1=${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const send = (body: string) => app.fetch(new Request(`${origin}/api/billing/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body }), env, ctx);
    const accepted = await send(payload);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ success: true });
    expect(await env.DB.prepare("SELECT id FROM stripe_events WHERE id = ?").bind("evt_hono_raw").first("id")).toBe("evt_hono_raw");
    expect((await send(payload + " ")).status).toBe(400);
  });
  it("streams binary bytes and Range headers, and runs one-time-file cleanup", async () => {
    const shareId = crypto.randomUUID();
    const bytes = new Uint8Array([0, 255, 13, 10, 192, 128, 1, 2]);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO shares(id, created_at, expires_at) VALUES (?, ?, ?)").bind(shareId, now, new Date(Date.now() + 86400000).toISOString()).run();
    async function file(maxDownloads: number | null) {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO files(id, share_id, storage_key, encrypted_file_name, size, max_downloads, download_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").bind(id, shareId, id, "encrypted-name", bytes.length, maxDownloads, now).run();
      await env.FILES_BUCKET.put(id, bytes);
      return id;
    }
    const id = await file(null);
    const full = await request(`/api/file/${id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(full.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const range = await app.fetch(new Request(`${origin}/api/file/${id}`, { headers: { Range: "bytes=2-5" } }), env, ctx);
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe("bytes 2-5/8");
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(2, 6));
    const head = await request(`/api/file/${id}`, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("Content-Length")).toBe("8");
    const once = await file(1);
    const response = await request(`/api/file/${once}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await Promise.all(background);
    expect(await env.FILES_BUCKET.head(once)).toBeNull();
    expect((await request(`/api/file/${once}`)).status).toBe(404);
  });
  it("rejects cross-origin logout without clearing session cookies", async () => {
    const response = await app.fetch(new Request(`${origin}/api/account/logout`, { method: "POST", headers: { Origin: "https://evil.example" } }), env, ctx);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
  it("passes route parameters to the download handler and returns JSON on missing shares", async () => {
    const response = await request("/api/download/missing-share");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
    expect(env.SHARE_RATE_LIMITER.keys).toContain("missing-share");
  });
  it("rejects unsigned billing webhooks", async () => {
    expect((await request("/api/billing/stripe/webhook", "POST", {})).status).toBe(400);
  });
  it.each(["/api/account/security", "/api/account/me"])("does not cache account responses: %s", async path => {
    const response = await request(path);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("distinguishes missing paths, unsupported methods and OPTIONS", async () => {
    expect((await request("/api/does-not-exist")).status).toBe(404);
    const wrong = await request("/api/account/login", "GET");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("OPTIONS, POST");
    const options = await request("/api/account/me", "OPTIONS");
    expect(options.status).toBe(204);
    expect(options.headers.get("Allow")).toContain("HEAD");
  });
});
