import { bindRouteHandlers } from "@/test/runtime";
import { withWorkerRuntime } from "@/server/runtime";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv, clearAllTables, insertTestAccount, stubTurnstileSuccess, type TestEnv } from "@/test/env";
import { createPasskeyFixture } from "@/test/passkeyFixture";
import { createSessionCookie, SESSION_COOKIE_NAME, verifySession } from "@/lib/account/session";
import { encodeBase64Url } from "@/lib/crypto/base64";
import { encryptAuthSecret } from "@/lib/account/authEncryption";
import { generateTotpSecret, totpAtStep } from "@/lib/account/totp";
import { SECURITY_COOKIE, commitSecurityChange, readAuthChallenge, reserveOtpAttempt, deleteExpiredAuthChallenges } from "@/lib/account/securityStore";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";

let env: TestEnv;
let dispose: () => Promise<void>;
const testRuntime = () => ({ env, ctx: { waitUntil: () => {} } });
import * as routeaccountlogin from "@/server/routes/account/login/route";
const { POST : login } = bindRouteHandlers(routeaccountlogin, testRuntime);
import * as routeaccountloginotp from "@/server/routes/account/login/otp/route";
const { POST : loginOtp } = bindRouteHandlers(routeaccountloginotp, testRuntime);
import * as routeaccountpasskeyoptions from "@/server/routes/account/passkey/options/route";
const { POST : passkeyOptions } = bindRouteHandlers(routeaccountpasskeyoptions, testRuntime);
import * as routeaccountpasskeyverify from "@/server/routes/account/passkey/verify/route";
const { POST : passkeyVerify } = bindRouteHandlers(routeaccountpasskeyverify, testRuntime);
import * as routeaccountrecover from "@/server/routes/account/recover/route";
const { POST : recover } = bindRouteHandlers(routeaccountrecover, testRuntime);
import { securityStatus, reauthPassword, reauthOptions, reauthVerify, passkeyRegisterOptions, passkeyRegisterVerify, passkeyDelete, totpSetup, totpConfirm, totpDisable, cancelSecurityOperation } from "@/lib/account/securityHandlers";

beforeAll(async () => { const handle = await createTestEnv(); env = handle.env; dispose = handle.dispose; });
afterAll(async () => dispose());
beforeEach(async () => { await clearAllTables(env); stubTurnstileSuccess(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const origin = "http://localhost:3000";
type Handler = (request: Request) => Promise<Response>;
function request(body: unknown = {}, cookies = "", method = "POST", requestOrigin = origin) {
  return new Request(`${origin}/api/account/test`, { method, headers: { "Content-Type": "application/json", cookie: cookies, origin: requestOrigin }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
const call = (handler: Handler, body: unknown = {}, cookies = "") => withWorkerRuntime({ env, ctx: { waitUntil: () => {} } }, () => handler(request(body, cookies)));
function cookie(response: Response, name?: string): string {
  const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]);
  return name ? cookies.find((value) => value.startsWith(`${name}=`)) ?? "" : cookies.join("; ");
}
async function signedIn(accountId: string, version = 0) { return (await createSessionCookie(accountId, version, env)).split(";")[0]; }
async function configureOtp(accountId: string, secret = generateTotpSecret()) {
  const encrypted = await encryptAuthSecret(secret, accountId, "totp", env.ACCOUNT_AUTH_ENCRYPTION_KEY);
  await env.DB.prepare("INSERT INTO account_totp(account_id, encrypted_secret) VALUES (?, ?)").bind(accountId, encrypted).run();
  return secret;
}
async function seedPasskey(accountId: string) {
  const fixture = await createPasskeyFixture();
  await env.DB.prepare(`INSERT INTO account_passkeys(id, account_id, webauthn_user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
    VALUES (?, ?, ?, ?, 0, '[]', 'singleDevice', 0, 'device', ?)`)
    .bind(fixture.id, accountId, fixture.userId, Array.from(fixture.publicKey), new Date().toISOString()).run();
  return fixture;
}
async function proof(accountId: string, password: string, action: string, extra: Record<string, unknown> = {}) {
  const session = await signedIn(accountId);
  const response = await call(reauthPassword, { action, password, turnstileToken: "tok", ...extra }, session);
  expect(response.status).toBe(200);
  return `${session}; ${cookie(response)}`;
}
async function code(secret: string, offset = 0) { return totpAtStep(secret, Math.floor(Date.now() / 30_000) + offset); }

describe("optional authentication", () => {
  it.each([false, true])("keeps password-only login without OTP (passkey: %s)", async (withKey) => {
    const account = await insertTestAccount(env);
    if (withKey) await seedPasskey(account.accountId);
    const response = await call(login, { ...account, turnstileToken: "tok" });
    expect(response.status).toBe(200);
    expect(cookie(response)).toContain(SESSION_COOKIE_NAME);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true });
  });

  it.each([false, true])("requires OTP before issuing a password login session (passkey: %s)", async (withKey) => {
    const account = await insertTestAccount(env);
    const secret = await configureOtp(account.accountId);
    if (withKey) await seedPasskey(account.accountId);
    const start = await call(login, { ...account, turnstileToken: "tok" });
    expect(await start.json()).toEqual({ success: true, next: "otp" });
    expect(cookie(start)).not.toContain(`${SESSION_COOKIE_NAME}=`);
    const response = await call(loginOtp, { code: await code(secret), accountId: "different" }, cookie(start));
    expect(response.status).toBe(200);
    expect(await verifySession(request({}, cookie(response, SESSION_COOKIE_NAME)), env)).toEqual({ accountId: account.accountId });
  });

  it("rejects OTP without the browser's password verification cookie", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const response = await call(loginOtp, { code: await code(secret), accountId: account.accountId });
    expect(response.status).toBe(403); expect(cookie(response)).not.toContain(SESSION_COOKIE_NAME);
  });

  it("does not let new password challenges reset the OTP attempt budget", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const valid = await code(secret);
    const wrong = valid === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      const start = await call(login, { ...account, turnstileToken: "tok" });
      expect(start.status).toBe(200);
      expect((await call(loginOtp, { code: wrong }, cookie(start))).status).toBe(403);
    }
    const start = await call(login, { ...account, turnstileToken: "tok" });
    expect((await call(loginOtp, { code: valid }, cookie(start))).status).toBe(429);
    const fixture = await seedPasskey(account.accountId);
    const optionsResponse = await call(passkeyOptions, { turnstileToken: "tok" });
    const { options } = await optionsResponse.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    const result = await call(passkeyVerify, { response: await fixture.authentication(options.challenge) }, cookie(optionsResponse));
    expect(result.status).toBe(200);
  });

  it("accepts at most one concurrent use of an OTP and rejects reuse across challenges", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const start = await call(login, { ...account, turnstileToken: "tok" });
    const submitted = await code(secret);
    const results = await Promise.all([call(loginOtp, { code: submitted }, cookie(start)), call(loginOtp, { code: submitted }, cookie(start))]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 403]);
    const second = await call(login, { ...account, turnstileToken: "tok" });
    expect((await call(loginOtp, { code: submitted }, cookie(second))).status).toBe(403);
  });

  it("rejects expired OTP challenges and obsolete session generations", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const start = await call(login, { ...account, turnstileToken: "tok" });
    await env.DB.prepare("UPDATE account_auth_challenges SET expires_at = 0").run();
    expect((await call(loginOtp, { code: await code(secret) }, cookie(start))).status).toBe(403);
    const second = await call(login, { ...account, turnstileToken: "tok" });
    await env.DB.prepare("UPDATE accounts SET session_version = session_version + 1 WHERE id = ?").bind(account.accountId).run();
    expect((await call(loginOtp, { code: await code(secret) }, cookie(second))).status).toBe(403);
  });

  it("fails closed when the OTP encryption key is wrong without logging secrets", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const start = await call(login, { ...account, turnstileToken: "tok" });
    const original = env.ACCOUNT_AUTH_ENCRYPTION_KEY;
    env.ACCOUNT_AUTH_ENCRYPTION_KEY = encodeBase64Url(new Uint8Array(32));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await call(loginOtp, { code: await code(secret) }, cookie(start));
      expect(response.status).toBe(500); expect(cookie(response)).not.toContain(SESSION_COOKIE_NAME);
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    } finally { env.ACCOUNT_AUTH_ENCRYPTION_KEY = original; }
  });
});

describe("security configuration", () => {
  it("requires a session, expected Origin and action-specific reauthentication", async () => {
    expect((await withWorkerRuntime({ env, ctx: { waitUntil: () => {} } }, () => securityStatus(request({}, "", "GET")))).status).toBe(401);
    const account = await insertTestAccount(env); const session = await signedIn(account.accountId);
    expect((await call(totpSetup, {}, session)).status).toBe(403);
    expect((await withWorkerRuntime({ env, ctx: { waitUntil: () => {} } }, () => reauthPassword(request({ action: "totp-enable", password: account.password, turnstileToken: "tok" }, session, "POST", "https://evil.example")))).status).toBe(403);
    const cookies = await proof(account.accountId, account.password, "passkey-add");
    expect((await call(totpSetup, {}, cookies)).status).toBe(403);
  });

  it("keeps OTP disabled until a valid first code, then invalidates all sessions", async () => {
    const account = await insertTestAccount(env);
    const session = await signedIn(account.accountId);
    const cookies = await proof(account.accountId, account.password, "totp-enable");
    const setup = await call(totpSetup, {}, cookies);
    const body = await setup.json() as { secret: string; uri: string };
    const setupCookies = `${session}; ${cookie(setup)}`;
    const before = await withWorkerRuntime({ env, ctx: { waitUntil: () => {} } }, () => securityStatus(request({}, session, "GET")));
    expect(await before.json()).toMatchObject({ totpEnabled: false });
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM account_auth_challenges").all())).not.toContain(body.secret);
    const confirmed = await call(totpConfirm, { code: await code(body.secret) }, setupCookies);
    expect(confirmed.status).toBe(200);
    expect(await verifySession(request({}, session), env)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_auth_challenges WHERE account_id = ?").bind(account.accountId).first("n")).toBe(0);
    const current = await signedIn(account.accountId, 1);
    const after = await withWorkerRuntime({ env, ctx: { waitUntil: () => {} } }, () => securityStatus(request({}, current, "GET")));
    const status = await after.json();
    expect(status).toMatchObject({ totpEnabled: true }); expect(JSON.stringify(status)).not.toContain(body.secret);
    expect((await call(totpConfirm, { code: await code(body.secret) }, setupCookies)).status).toBe(401);
  });

  it("does not enable OTP with an invalid, cancelled or expired setup", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "totp-enable");
    const setup = await call(totpSetup, {}, cookies);
    const { secret } = await setup.json() as { secret: string };
    const setupCookies = `${await signedIn(account.accountId)}; ${cookie(setup)}`;
    const valid = await code(secret);
    expect((await call(totpConfirm, { code: valid === "000000" ? "000001" : "000000" }, setupCookies)).status).toBe(403);
    await env.DB.prepare("UPDATE account_auth_challenges SET expires_at = 0").run();
    expect((await call(totpConfirm, { code: valid }, setupCookies)).status).toBe(403);
    expect(await env.DB.prepare("SELECT encrypted_secret FROM account_totp WHERE account_id = ?").bind(account.accountId).first("encrypted_secret")).toBeNull();
  });

  it("allows only one concurrent OTP setup completion", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "totp-enable");
    const setup = await call(totpSetup, {}, cookies);
    const { secret } = await setup.json() as { secret: string };
    const setupCookies = `${await signedIn(account.accountId)}; ${cookie(setup)}`;
    const results = await Promise.all([call(totpConfirm, { code: await code(secret) }, setupCookies), call(totpConfirm, { code: await code(secret) }, setupCookies)]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT session_version FROM accounts WHERE id = ?").bind(account.accountId).first("session_version")).toBe(1);
  });

  it("requires current OTP for password reauthentication and removes it on disable", async () => {
    const account = await insertTestAccount(env); const secret = await configureOtp(account.accountId);
    const session = await signedIn(account.accountId);
    expect((await call(reauthPassword, { action: "totp-disable", password: account.password, turnstileToken: "tok" }, session)).status).toBe(403);
    const cookies = await proof(account.accountId, account.password, "totp-disable", { code: await code(secret) });
    expect((await call(totpDisable, {}, cookies)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_totp WHERE account_id = ?").bind(account.accountId).first("n")).toBe(0);
    expect(await verifySession(request({}, session), env)).toBeNull();
    expect((await call(login, { ...account, turnstileToken: "tok" })).headers.get("Set-Cookie")).toContain(SESSION_COOKIE_NAME);
  });

  it("cannot apply another account's operation proof or a proof for another deletion target", async () => {
    const alice = await insertTestAccount(env); const bob = await insertTestAccount(env);
    const key = await seedPasskey(alice.accountId);
    const cookies = await proof(alice.accountId, alice.password, "passkey-delete", { targetId: key.id });
    expect((await call(passkeyDelete, { id: "other" }, cookies)).status).toBe(403);
    const foreign = `${await signedIn(bob.accountId)}; ${cookies.split("; ").find((value) => value.startsWith(SECURITY_COOKIE))}`;
    expect((await call(passkeyDelete, { id: key.id }, foreign)).status).toBe(403);
    expect((await call(passkeyDelete, { id: key.id }, cookies)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_passkeys WHERE id = ?").bind(key.id).first("n")).toBe(0);
  });

  it("removes expired authentication data during cleanup", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "totp-enable");
    expect((await call(totpSetup, {}, cookies)).status).toBe(200);
    await env.DB.prepare("UPDATE account_auth_challenges SET expires_at = 0").run();
    await deleteExpiredAuthChallenges(env);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_auth_challenges").first("n")).toBe(0);
  });
});

describe("passkeys", () => {
  it("registers a real public key and logs in without ID, password or OTP", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "passkey-add");
    const optionsResponse = await call(passkeyRegisterOptions, { name: "phone" }, cookies);
    expect(optionsResponse.status).toBe(200);
    const { options } = await optionsResponse.json() as { options: PublicKeyCredentialCreationOptionsJSON };
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    const fixture = await createPasskeyFixture();
    const response = await call(passkeyRegisterVerify, { response: await fixture.registration(options.challenge) }, cookies);
    expect(response.status).toBe(200);
    expect(await verifySession(request({}, cookies), env)).toBeNull();
    await configureOtp(account.accountId);
    const start = await call(passkeyOptions, { turnstileToken: "tok" });
    const loginOptions = (await start.json() as { options: PublicKeyCredentialRequestOptionsJSON }).options;
    expect(loginOptions.allowCredentials).toBeUndefined();
    const signed = await fixture.authentication(loginOptions.challenge, { userHandle: options.user.id });
    const loggedIn = await call(passkeyVerify, { response: signed }, cookie(start));
    expect(loggedIn.status).toBe(200);
    expect(await verifySession(request({}, cookie(loggedIn, SESSION_COOKIE_NAME)), env)).toEqual({ accountId: account.accountId });
    expect((await call(passkeyVerify, { response: signed }, cookie(start))).status).toBe(403);
  });

  it.each(["origin", "rpID", "flags", "challenge", "signature", "userHandle"])("rejects an invalid assertion (%s)", async (field) => {
    const account = await insertTestAccount(env); const fixture = await seedPasskey(account.accountId);
    const start = await call(passkeyOptions, { turnstileToken: "tok" });
    const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    const signed = await fixture.authentication(field === "challenge" ? "wrong-challenge" : options.challenge, {
      ...(field === "origin" ? { origin: "https://evil.example" } : {}),
      ...(field === "rpID" ? { rpID: "evil.example" } : {}),
      ...(field === "flags" ? { flags: 0x01 } : {}),
      ...(field === "userHandle" ? { userHandle: "different" } : {}),
    });
    if (field === "signature") signed.response.signature = encodeBase64Url(new Uint8Array(256));
    const response = await call(passkeyVerify, { response: signed }, cookie(start));
    expect(response.status).toBe(403); expect(cookie(response)).not.toContain(SESSION_COOKIE_NAME);
  });

  it("requires Turnstile and a browser-bound challenge for passkey login", async () => {
    const account = await insertTestAccount(env); const fixture = await seedPasskey(account.accountId);
    expect((await call(passkeyOptions, {})).status).toBe(403);
    const start = await call(passkeyOptions, { turnstileToken: "tok" });
    const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    expect((await call(passkeyVerify, { response: await fixture.authentication(options.challenge) })).status).toBe(403);
    await env.DB.prepare("UPDATE account_auth_challenges SET expires_at = 0").run();
    expect((await call(passkeyVerify, { response: await fixture.authentication(options.challenge) }, cookie(start))).status).toBe(403);
  });

  it("accepts at most one concurrent assertion for the same challenge", async () => {
    const account = await insertTestAccount(env); const fixture = await seedPasskey(account.accountId);
    const start = await call(passkeyOptions, { turnstileToken: "tok" });
    const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    const response = await fixture.authentication(options.challenge);
    const results = await Promise.all([call(passkeyVerify, { response }, cookie(start)), call(passkeyVerify, { response }, cookie(start))]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
  });

  it("requires the account's own passkey for sensitive-operation reauthentication", async () => {
    const alice = await insertTestAccount(env); const bob = await insertTestAccount(env);
    const own = await seedPasskey(alice.accountId); const other = await seedPasskey(bob.accountId);
    await configureOtp(alice.accountId);
    const session = await signedIn(alice.accountId);
    const start = await call(reauthOptions, { action: "totp-disable" }, session);
    const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    const cookies = `${session}; ${cookie(start)}`;
    expect((await call(reauthVerify, { response: await other.authentication(options.challenge) }, cookies)).status).toBe(403);
    expect((await call(reauthVerify, { response: await own.authentication(options.challenge) }, cookies)).status).toBe(200);
    expect((await call(totpDisable, {}, cookies)).status).toBe(200);
  });

  it("enforces the ten-passkey limit", async () => {
    const account = await insertTestAccount(env); const fixture = await seedPasskey(account.accountId);
    for (let i = 1; i < 10; i++) {
      await env.DB.prepare(`INSERT INTO account_passkeys SELECT ?, account_id, webauthn_user_id, public_key, counter, transports, device_type, backed_up, name, created_at FROM account_passkeys WHERE id = ?`)
        .bind(`credential-${i}`, fixture.id).run();
    }
    const cookies = await proof(account.accountId, account.password, "passkey-add");
    expect((await call(passkeyRegisterOptions, { name: "extra" }, cookies)).status).toBe(409);
  });
});

describe("account recovery", () => {
  it("resets all factors, pending operations and sessions, and consumes the code once", async () => {
    const account = await insertTestAccount(env); await seedPasskey(account.accountId); await configureOtp(account.accountId);
    const session = await signedIn(account.accountId);
    await call(login, { ...account, turnstileToken: "tok" });
    const body = { ...account, newPassword: "new-password-123", turnstileToken: "tok" };
    const responses = await Promise.all([call(recover, body), call(recover, body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
    for (const table of ["account_passkeys", "account_totp", "account_auth_challenges"]) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).bind(account.accountId).first("n")).toBe(0);
    }
    expect(await verifySession(request({}, session), env)).toBeNull();
    const loginResponse = await call(login, { accountId: account.accountId, password: body.newPassword, turnstileToken: "tok" });
    expect(await loginResponse.json()).toEqual({ success: true });
  });
});


describe("conditional mutation guards", () => {
  it("cancels and deletes the pending encrypted OTP secret without enabling it", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "totp-enable");
    const setup = await call(totpSetup, {}, cookies);
    const { secret } = await setup.json() as { secret: string };
    const pending = `${await signedIn(account.accountId)}; ${cookie(setup)}`;
    expect((await call(cancelSecurityOperation, {}, pending)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_auth_challenges").first("n")).toBe(0);
    expect((await call(totpConfirm, { code: await code(secret) }, pending)).status).toBe(403);
    expect(await env.DB.prepare("SELECT encrypted_secret FROM account_totp WHERE account_id = ?").bind(account.accountId).first("encrypted_secret")).toBeNull();
  });

  it("refuses mutations from a stale proof even when the remaining batch runs", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "passkey-delete", { targetId: "key" });
    const challenge = await readAuthChallenge(env, request({}, cookies), SECURITY_COOKIE, "reauth-proof");
    await env.DB.prepare("UPDATE accounts SET session_version = 1 WHERE id = ?").bind(account.accountId).run();
    await expect(commitSecurityChange(env, challenge, (guard, values) => [
      env.DB.prepare(`UPDATE accounts SET plan = 'premium' WHERE id = ? AND ${guard}`).bind(account.accountId, ...values),
    ])).rejects.toThrow();
    expect(await env.DB.prepare("SELECT plan FROM accounts WHERE id = ?").bind(account.accountId).first("plan")).toBe("free");
    expect(await env.DB.prepare("SELECT session_version FROM accounts WHERE id = ?").bind(account.accountId).first("session_version")).toBe(1);
  });

  it("resets only the OTP budget after the five-minute window has elapsed", async () => {
    const account = await insertTestAccount(env);
    for (let i = 0; i < 5; i++) await reserveOtpAttempt(env, account.accountId);
    await expect(reserveOtpAttempt(env, account.accountId)).rejects.toMatchObject({ status: 429 });
    await env.DB.prepare("UPDATE account_totp SET window_started_at = ? WHERE account_id = ?").bind(Date.now() - 300_000, account.accountId).run();
    await reserveOtpAttempt(env, account.accountId);
    expect(await env.DB.prepare("SELECT attempts FROM account_totp WHERE account_id = ?").bind(account.accountId).first("attempts")).toBe(1);
  });

  it("refuses the eleventh key when capacity is reached after options issuance", async () => {
    const account = await insertTestAccount(env);
    const cookies = await proof(account.accountId, account.password, "passkey-add");
    const optionsResponse = await call(passkeyRegisterOptions, { name: "device" }, cookies);
    const { options } = await optionsResponse.json() as { options: PublicKeyCredentialCreationOptionsJSON };
    const fixture = await createPasskeyFixture();
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(`INSERT INTO account_passkeys(id, account_id, webauthn_user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
        VALUES (?, ?, ?, ?, 0, '[]', 'singleDevice', 0, 'device', ?)`)
        .bind(`existing-${i}`, account.accountId, fixture.userId, Array.from(fixture.publicKey), new Date().toISOString()).run();
    }
    const response = await call(passkeyRegisterVerify, { response: await fixture.registration(options.challenge) }, cookies);
    expect(response.status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_passkeys WHERE account_id = ?").bind(account.accountId).first("n")).toBe(10);
    expect(await env.DB.prepare("SELECT session_version FROM accounts WHERE id = ?").bind(account.accountId).first("session_version")).toBe(0);
  });
});

it("rejects a passkey login when settings change after signature verification but before session grant", async () => {
  const account = await insertTestAccount(env);
  const fixture = await seedPasskey(account.accountId);
  const start = await call(passkeyOptions, { turnstileToken: "tok" });
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const verify = crypto.subtle.verify.bind(crypto.subtle);
  const intercept = vi.spyOn(crypto.subtle, "verify").mockImplementation(async (...args) => {
    const valid = await verify(...args);
    if (valid) {
      // 実署名の検証直後へ設定変更を確実に割り込ませる。
      await env.DB.prepare("UPDATE accounts SET session_version = session_version + 1 WHERE id = ?").bind(account.accountId).run();
    }
    return valid;
  });
  try {
    const response = await call(passkeyVerify, { response: await fixture.authentication(options.challenge) }, cookie(start));
    expect(intercept).toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(cookie(response)).not.toContain(SESSION_COOKIE_NAME);
    expect(await env.DB.prepare("SELECT session_version FROM accounts WHERE id = ?").bind(account.accountId).first("session_version")).toBe(1);
  } finally { intercept.mockRestore(); }
});
