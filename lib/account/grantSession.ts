import { createSessionCookie } from "./session";
import { authJson, AccountAuthError } from "./authHttp";

export async function grantAccountSession(env: CloudflareEnv, accountId: string, sessionVersion: number,
  passwordOnly = false, extraCookies: string[] = []): Promise<Response> {
  // 認証中に設定やパスワードが変わった場合、古い証明を新しい世代のCookieにしない。
  const result = await env.DB.prepare(`UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL
    WHERE id = ? AND session_version = ? ${passwordOnly ? "AND NOT EXISTS (SELECT 1 FROM account_totp WHERE account_id = accounts.id AND encrypted_secret IS NOT NULL)" : ""}`)
    .bind(accountId, sessionVersion).run();
  if (result.meta.changes !== 1) throw new AccountAuthError("認証設定が変更されました。最初からログインしてください。");
  return authJson({ success: true }, 200, [await createSessionCookie(accountId, sessionVersion, env), ...extraCookies]);
}
