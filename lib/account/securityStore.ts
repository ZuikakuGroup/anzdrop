import { encodeBase64Url } from "@/lib/crypto/base64";
import { extractCookie, buildSetCookie } from "@/lib/cookie";
import { AccountAuthError } from "./authHttp";
import type { SecurityAction } from "./securityTypes";
import { decryptAuthSecret } from "./authEncryption";
import { matchTotpStep } from "./totp";

export const OTP_LOGIN_COOKIE = "__Host-anzdrop_otp_login";
export const PASSKEY_LOGIN_COOKIE = "__Host-anzdrop_passkey_login";
export const SECURITY_COOKIE = "__Host-anzdrop_security";
export const AUTH_DURATION_MS = 5 * 60_000;
export const OTP_SETUP_DURATION_MS = 10 * 60_000;

export type SecurityAccount = { id: string; password_hash: string; session_version: number; encrypted_secret: string | null };
export type PasskeyRow = { id: string; account_id: string; webauthn_user_id: string; public_key: ArrayBuffer; counter: number; transports: string; device_type: "singleDevice" | "multiDevice"; backed_up: number; name: string; created_at: string };
export type AuthChallenge = {
  id: string; account_id: string | null; session_version: number | null; purpose: string;
  action: SecurityAction | null; target_id: string | null; challenge: string | null; payload: string | null;
  expires_at: number; claim: string | null;
};

export async function readSecurityAccount(env: CloudflareEnv, accountId: string): Promise<SecurityAccount | null> {
  return env.DB.prepare(`SELECT a.id, a.password_hash, a.session_version, t.encrypted_secret FROM accounts a LEFT JOIN account_totp t ON t.account_id = a.id WHERE a.id = ?`).bind(accountId).first<SecurityAccount>();
}

export async function listPasskeys(env: CloudflareEnv, accountId: string): Promise<PasskeyRow[]> {
  return (await env.DB.prepare("SELECT * FROM account_passkeys WHERE account_id = ? ORDER BY created_at, id").bind(accountId).all<PasskeyRow>()).results;
}

async function tokenHash(token: string): Promise<string> {
  return encodeBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

export async function deleteExpiredAuthChallenges(env: CloudflareEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM account_auth_challenges WHERE expires_at <= ?").bind(Date.now()).run();
  // 設定を中断したアカウントに、不要なOTP試行情報を残さない。
  await env.DB.prepare(`DELETE FROM account_totp WHERE encrypted_secret IS NULL AND window_started_at <= ? AND NOT EXISTS
    (SELECT 1 FROM account_auth_challenges c WHERE c.account_id = account_totp.account_id AND c.purpose = 'totp-setup')`).bind(Date.now() - AUTH_DURATION_MS).run();
}

export async function createAuthChallenge(env: CloudflareEnv, request: Request, cookieName: string,
  data: Omit<AuthChallenge, "id" | "claim" | "expires_at">, duration = AUTH_DURATION_MS): Promise<string> {
  await deleteExpiredAuthChallenges(env);
  const previous = extractCookie(request.headers.get("cookie"), cookieName);
  const token = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await tokenHash(token);
  const statements = [];
  if (previous) statements.push(env.DB.prepare("DELETE FROM account_auth_challenges WHERE id = ?").bind(await tokenHash(previous)));
  statements.push(env.DB.prepare(`INSERT INTO account_auth_challenges
    (id, account_id, session_version, purpose, action, target_id, challenge, payload, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, data.account_id, data.session_version, data.purpose, data.action, data.target_id, data.challenge, data.payload, Date.now() + duration));
  await env.DB.batch(statements);
  return buildSetCookie(cookieName, token, Math.ceil(duration / 1000));
}

export async function readAuthChallenge(env: CloudflareEnv, request: Request, cookieName: string, purpose?: string): Promise<AuthChallenge> {
  await deleteExpiredAuthChallenges(env);
  const token = extractCookie(request.headers.get("cookie"), cookieName);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountAuthError("認証の有効期限が切れました。最初からやり直してください。");
  const challenge = await env.DB.prepare("SELECT * FROM account_auth_challenges WHERE id = ? AND (? IS NULL OR purpose = ?) AND expires_at > ? AND claim IS NULL").bind(await tokenHash(token), purpose ?? null, purpose ?? null, Date.now()).first<AuthChallenge>();
  if (!challenge) throw new AccountAuthError("認証の有効期限が切れました。最初からやり直してください。");
  return challenge;
}

export async function consumeAuthChallenge(env: CloudflareEnv, challenge: AuthChallenge): Promise<void> {
  const result = await env.DB.prepare(`DELETE FROM account_auth_challenges WHERE id = ? AND purpose = ? AND expires_at > ? AND claim IS NULL
    AND (account_id IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE id = account_auth_challenges.account_id AND session_version = account_auth_challenges.session_version))`).bind(challenge.id, challenge.purpose, Date.now()).run();
  if (result.meta.changes !== 1) throw new AccountAuthError();
}

export async function transitionAuthChallenge(env: CloudflareEnv, challenge: AuthChallenge, purpose: string, payload: string | null, webauthnChallenge: string | null = null, duration = AUTH_DURATION_MS): Promise<void> {
  const result = await env.DB.prepare(`UPDATE account_auth_challenges SET purpose = ?, payload = ?, challenge = ?, expires_at = ?
    WHERE id = ? AND purpose = ? AND expires_at > ? AND claim IS NULL AND EXISTS
    (SELECT 1 FROM accounts WHERE id = account_auth_challenges.account_id AND session_version = account_auth_challenges.session_version)`)
    .bind(purpose, payload, webauthnChallenge, Date.now() + duration, challenge.id, challenge.purpose, Date.now()).run();
  if (result.meta.changes !== 1) throw new AccountAuthError();
}

export async function reserveOtpAttempt(env: CloudflareEnv, accountId: string): Promise<void> {
  const now = Date.now();
  const result = await env.DB.prepare(`INSERT INTO account_totp(account_id, attempts, window_started_at) VALUES (?, 1, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END
    WHERE window_started_at <= ? OR attempts < 5 RETURNING attempts`)
    .bind(accountId, now, now - AUTH_DURATION_MS, now - AUTH_DURATION_MS, now, now - AUTH_DURATION_MS).first<{ attempts: number }>();
  if (!result) throw new AccountAuthError("認証コードの試行回数が上限に達しました。5分ほど待ってから再試行してください。", 429);
}

export async function verifyAccountOtp(env: CloudflareEnv, account: SecurityAccount, code: string): Promise<void> {
  if (!account.encrypted_secret) throw new AccountAuthError();
  await reserveOtpAttempt(env, account.id);
  const secret = await decryptAuthSecret(account.encrypted_secret, account.id, "totp", env.ACCOUNT_AUTH_ENCRYPTION_KEY);
  const step = await matchTotpStep(secret, code);
  if (step === null) throw new AccountAuthError("認証コードが正しくないか、期限が切れています。");
  const result = await env.DB.prepare(`UPDATE account_totp SET last_used_step = ? WHERE account_id = ? AND encrypted_secret = ? AND last_used_step < ?
    AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND session_version = ?)`)
    .bind(step, account.id, account.encrypted_secret, step, account.id, account.session_version).run();
  if (result.meta.changes !== 1) throw new AccountAuthError("この認証コードは使用済みです。次のコードで再試行してください。");
}

// 操作ごとのランダムclaimをトランザクション内で確保する。0行更新の場合も
// 後続SQLが動くbatchの性質を考慮し、すべての変更を同じclaimで条件付けする。
export async function commitSecurityChange(env: CloudflareEnv, challenge: AuthChallenge,
  changes: (guard: string, guardValues: unknown[]) => D1PreparedStatement[], eligibility = "1", eligibilityValues: unknown[] = []): Promise<void> {
  if (!challenge.account_id || challenge.session_version === null) throw new AccountAuthError();
  const claim = crypto.randomUUID();
  const guard = `EXISTS (SELECT 1 FROM account_auth_challenges c JOIN accounts a ON a.id = c.account_id
    WHERE c.id = ? AND c.claim = ? AND a.session_version = ? AND c.session_version = a.session_version)`;
  const guardValues = [challenge.id, claim, challenge.session_version];
  const claimStatement = env.DB.prepare(`UPDATE account_auth_challenges SET claim = ?
    WHERE id = ? AND purpose = ? AND claim IS NULL AND expires_at > ? AND EXISTS
    (SELECT 1 FROM accounts a WHERE a.id = account_auth_challenges.account_id AND a.session_version = account_auth_challenges.session_version)
    AND (${eligibility})`).bind(claim, challenge.id, challenge.purpose, Date.now(), ...eligibilityValues);
  const mutations = changes(guard, guardValues);
  const increment = env.DB.prepare(`UPDATE accounts SET session_version = session_version + 1 WHERE id = ? AND ${guard}`).bind(challenge.account_id, ...guardValues);
  const cleanup = env.DB.prepare(`WITH authorized AS MATERIALIZED
    (SELECT id FROM account_auth_challenges WHERE id = ? AND claim = ?)
    DELETE FROM account_auth_challenges WHERE account_id = ? AND EXISTS (SELECT 1 FROM authorized)`)
    .bind(challenge.id, claim, challenge.account_id);
  const results = await env.DB.batch([claimStatement, ...mutations, increment, cleanup]);
  if (results[mutations.length + 1].meta.changes !== 1) throw new AccountAuthError("設定が変更されました。再度ログインしてください。");
}
