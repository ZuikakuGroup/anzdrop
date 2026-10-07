import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { buildSetCookie, extractCookie } from "@/lib/cookie";
import { checkRateLimit } from "@/lib/rateLimit";
import { verifySession, clearSessionCookie } from "./session";
import { AccountAuthError, authJson, requireAuthOrigin, withAccountAuthHandler } from "./authHttp";
import { ActionSchema, PasswordReauthSchema, CodeSchema } from "./authSchemas";
import { authenticateAccountPassword } from "./passwordAuthentication";
import { encryptAuthSecret, decryptAuthSecret } from "./authEncryption";
import { generateTotpSecret, matchTotpStep, totpUri } from "./totp";
import { AuthenticationSchema, RegistrationSchema, authenticationOptions, registrationOptions, verifyPasskey, verifyNewPasskey } from "./passkeys";
import { SECURITY_COOKIE, OTP_SETUP_DURATION_MS, commitSecurityChange, createAuthChallenge, listPasskeys,
  readAuthChallenge, readSecurityAccount, reserveOtpAttempt, transitionAuthChallenge, verifyAccountOtp,
  consumeAuthChallenge,
  type SecurityAccount, type AuthChallenge } from "./securityStore";
import type { SecurityAction } from "./securityTypes";

async function requireSecurityAccount(request: Request, env: CloudflareEnv): Promise<SecurityAccount> {
  if (request.method !== "GET") requireAuthOrigin(request);
  const session = await verifySession(request, env, true);
  if (!session) throw new AccountAuthError("ログインしていません", 401);
  const account = await readSecurityAccount(env, session.accountId);
  if (!account || account.session_version !== session.sessionVersion) throw new AccountAuthError("再度ログインしてください。", 401);
  return account;
}

async function requireSecurityChallenge(request: Request, env: CloudflareEnv, purpose: string, action?: SecurityAction): Promise<{ account: SecurityAccount; challenge: AuthChallenge }> {
  const account = await requireSecurityAccount(request, env);
  const challenge = await readAuthChallenge(env, request, SECURITY_COOKIE, purpose);
  if (challenge.account_id !== account.id || challenge.session_version !== account.session_version
    || (action && challenge.action !== action)) throw new AccountAuthError();
  return { account, challenge };
}

function changedResponse() {
  return authJson({ success: true }, 200, [clearSessionCookie(), buildSetCookie(SECURITY_COOKIE, "", 0)]);
}

export const securityStatus = withAccountAuthHandler("GET /api/account/security", async (request, env) => {
  const account = await requireSecurityAccount(request, env);
  const keys = await listPasskeys(env, account.id);
  return authJson({ success: true, accountId: account.id, totpEnabled: account.encrypted_secret !== null,
    passkeys: keys.map((key) => ({ id: key.id, name: key.name, createdAt: key.created_at })),
  });
});

export const cancelSecurityOperation = withAccountAuthHandler("POST /api/account/security/cancel", async (request, env) => {
  const account = await requireSecurityAccount(request, env);
  try {
    const challenge = await readAuthChallenge(env, request, SECURITY_COOKIE);
    if (challenge.account_id !== account.id || challenge.session_version !== account.session_version) throw new AccountAuthError();
    await consumeAuthChallenge(env, challenge);
  } catch (error) {
    // 期限切れ・既に中止済みでもCookieを消す。DB障害は成功にしない。
    if (!(error instanceof AccountAuthError)) throw error;
  }
  return authJson({ success: true }, 200, [buildSetCookie(SECURITY_COOKIE, "", 0)]);
});

export const reauthPassword = withAccountAuthHandler("POST /api/account/security/reauth/password", async (request, env) => {
  const sessionAccount = await requireSecurityAccount(request, env);
  const parsed = await parseJsonBody(request, PasswordReauthSchema);
  if (!parsed.ok) return parsed.response;
  const account = await authenticateAccountPassword(env, sessionAccount.id, parsed.data.password, parsed.data.turnstileToken);
  if (account.session_version !== sessionAccount.session_version) throw new AccountAuthError();
  if (account.encrypted_secret) await verifyAccountOtp(env, account, parsed.data.code ?? "");
  const cookie = await createAuthChallenge(env, request, SECURITY_COOKIE, {
    account_id: account.id, session_version: account.session_version, purpose: "reauth-proof", action: parsed.data.action,
    target_id: parsed.data.targetId ?? null, challenge: null, payload: null,
  });
  return authJson({ success: true }, 200, [cookie]);
});

export const reauthOptions = withAccountAuthHandler("POST /api/account/security/reauth/options", async (request, env) => {
  const account = await requireSecurityAccount(request, env);
  const parsed = await parseJsonBody(request, ActionSchema);
  if (!parsed.ok) return parsed.response;
  const limited = await checkRateLimit(env.ACCOUNT_RATE_LIMITER, account.id, "security/reauth/options");
  if (!limited.ok) return limited.response;
  const keys = await listPasskeys(env, account.id);
  if (!keys.length) throw new AccountAuthError();
  const options = await authenticationOptions(keys);
  const cookie = await createAuthChallenge(env, request, SECURITY_COOKIE, {
    account_id: account.id, session_version: account.session_version, purpose: "reauth-passkey", action: parsed.data.action,
    target_id: parsed.data.targetId ?? null, challenge: options.challenge, payload: null,
  });
  return authJson({ success: true, options }, 200, [cookie]);
});

export const reauthVerify = withAccountAuthHandler("POST /api/account/security/reauth/verify", async (request, env) => {
  const { challenge } = await requireSecurityChallenge(request, env, "reauth-passkey");
  const parsed = await parseJsonBody(request, z.object({ response: AuthenticationSchema }));
  if (!parsed.ok) return parsed.response;
  await verifyPasskey(env, challenge, parsed.data.response);
  await transitionAuthChallenge(env, challenge, "reauth-proof", null);
  return authJson({ success: true });
});

export const passkeyRegisterOptions = withAccountAuthHandler("POST /api/account/security/passkeys/options", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "reauth-proof", "passkey-add");
  const parsed = await parseJsonBody(request, z.object({ name: z.string().trim().min(1).max(64) }));
  if (!parsed.ok) return parsed.response;
  const { options, userId } = await registrationOptions(env, account.id);
  await transitionAuthChallenge(env, challenge, "passkey-register", JSON.stringify({ name: parsed.data.name, userId }), options.challenge);
  return authJson({ success: true, options });
});

export const passkeyRegisterVerify = withAccountAuthHandler("POST /api/account/security/passkeys/verify", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "passkey-register", "passkey-add");
  const parsed = await parseJsonBody(request, z.object({ response: RegistrationSchema }));
  if (!parsed.ok) return parsed.response;
  const info = await verifyNewPasskey(challenge, parsed.data.response);
  const payload = z.object({ name: z.string().min(1).max(64), userId: z.string() }).parse(JSON.parse(challenge.payload ?? "null"));
  await commitSecurityChange(env, challenge, (guard, values) => [
    env.DB.prepare(`INSERT INTO account_passkeys(id, account_id, webauthn_user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
      .bind(info.credential.id, account.id, payload.userId, Array.from(info.credential.publicKey), info.credential.counter,
        JSON.stringify(info.credential.transports ?? []), info.credentialDeviceType, Number(info.credentialBackedUp), payload.name, new Date().toISOString(), ...values),
  ], "(SELECT COUNT(*) FROM account_passkeys WHERE account_id = ?) < 10 AND NOT EXISTS (SELECT 1 FROM account_passkeys WHERE id = ?)", [account.id, info.credential.id]);
  return changedResponse();
});

export const passkeyDelete = withAccountAuthHandler("POST /api/account/security/passkeys/delete", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "reauth-proof", "passkey-delete");
  const parsed = await parseJsonBody(request, z.object({ id: z.string().min(1).max(2048) }));
  if (!parsed.ok) return parsed.response;
  if (parsed.data.id !== challenge.target_id) throw new AccountAuthError();
  await commitSecurityChange(env, challenge, (guard, values) => [
    env.DB.prepare(`DELETE FROM account_passkeys WHERE id = ? AND account_id = ? AND ${guard}`).bind(parsed.data.id, account.id, ...values),
  ], "EXISTS (SELECT 1 FROM account_passkeys WHERE id = ? AND account_id = ?)", [parsed.data.id, account.id]);
  return changedResponse();
});

export const totpSetup = withAccountAuthHandler("POST /api/account/security/totp/setup", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "reauth-proof", "totp-enable");
  if (account.encrypted_secret) throw new AccountAuthError("OTPはすでに有効です。", 409);
  const secret = generateTotpSecret();
  const encrypted = await encryptAuthSecret(secret, account.id, "totp-setup", env.ACCOUNT_AUTH_ENCRYPTION_KEY);
  await transitionAuthChallenge(env, challenge, "totp-setup", encrypted, null, OTP_SETUP_DURATION_MS);
  const token = extractCookie(request.headers.get("cookie"), SECURITY_COOKIE)!;
  return authJson({ success: true, secret, uri: totpUri(account.id, secret) }, 200,
    [buildSetCookie(SECURITY_COOKIE, token, OTP_SETUP_DURATION_MS / 1000)]);
});

export const totpConfirm = withAccountAuthHandler("POST /api/account/security/totp/confirm", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "totp-setup", "totp-enable");
  const parsed = await parseJsonBody(request, CodeSchema);
  if (!parsed.ok) return parsed.response;
  if (account.encrypted_secret || !challenge.payload) throw new AccountAuthError();
  await reserveOtpAttempt(env, account.id);
  const secret = await decryptAuthSecret(challenge.payload, account.id, "totp-setup", env.ACCOUNT_AUTH_ENCRYPTION_KEY);
  const step = await matchTotpStep(secret, parsed.data.code);
  if (step === null) throw new AccountAuthError("認証コードが正しくないか、期限が切れています。");
  const encrypted = await encryptAuthSecret(secret, account.id, "totp", env.ACCOUNT_AUTH_ENCRYPTION_KEY);
  await commitSecurityChange(env, challenge, (guard, values) => [
    env.DB.prepare(`UPDATE account_totp SET encrypted_secret = ?, last_used_step = ? WHERE account_id = ? AND ${guard}`).bind(encrypted, step, account.id, ...values),
  ], "EXISTS (SELECT 1 FROM account_totp WHERE account_id = ? AND encrypted_secret IS NULL)", [account.id]);
  return changedResponse();
});

export const totpDisable = withAccountAuthHandler("POST /api/account/security/totp/disable", async (request, env) => {
  const { account, challenge } = await requireSecurityChallenge(request, env, "reauth-proof", "totp-disable");
  await commitSecurityChange(env, challenge, (guard, values) => [
    env.DB.prepare(`DELETE FROM account_totp WHERE account_id = ? AND ${guard}`).bind(account.id, ...values),
  ], "EXISTS (SELECT 1 FROM account_totp WHERE account_id = ? AND encrypted_secret IS NOT NULL)", [account.id]);
  return changedResponse();
});
