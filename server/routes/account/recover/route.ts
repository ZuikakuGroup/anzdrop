import { generateRecoveryCode } from "@/lib/account/id";
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from "@/lib/account/password";
import { requireTurnstile } from "@/lib/turnstile";
import { withAccountAuthHandler, AccountAuthError, authJson } from "@/lib/account/authHttp";
import { clearSessionCookie } from "@/lib/account/session";
import { parseJsonBody } from "@/lib/api/validate";
import {
  RecoverRequestSchema,
  type RecoverResponse,
} from "@/lib/api/schemas/account/recover/schema";

const INVALID_RECOVERY_ERROR = "アカウントIDまたはリカバリーコードが正しくありません";

export const POST = withAccountAuthHandler(
  "POST /api/account/recover",
  async (request, env): Promise<Response> => {

    const parsed = await parseJsonBody(request, RecoverRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { accountId, recoveryCode, newPassword } = parsed.data;

    const turnstile = await requireTurnstile(
      parsed.data.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!turnstile.ok) {
      return turnstile.response;
    }

    const account = await env.DB.prepare(
      `SELECT recovery_code_hash, session_version FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(accountId)
      .first<{ recovery_code_hash: string; session_version: number }>();

    const recoveryCodeMatches = await verifyPassword(
      recoveryCode,
      account?.recovery_code_hash ?? DUMMY_PASSWORD_HASH
    );

    if (!account || !recoveryCodeMatches) {
      return Response.json(
        { success: false, error: INVALID_RECOVERY_ERROR },
        { status: 403 }
      );
    }

    // 新しいパスワードと、使い捨てのリカバリーコードを両方発行し直す。
    const newRecoveryCode = generateRecoveryCode();
    const [newPasswordHash, newRecoveryCodeHash] = await Promise.all([
      hashPassword(newPassword),
      hashPassword(newRecoveryCode),
    ]);

    // session_versionをインクリメントし、この時点までに発行済みの
    // セッションCookie(盗まれている可能性がある)を全て無効化する。
    // リカバリーコードによる本人確認ができた時点で、ログイン失敗回数による
    // ロックアウト状態も解除する。
    const reset = env.DB.prepare(
      `
      UPDATE accounts
      SET password_hash = ?,
          recovery_code_hash = ?,
          session_version = session_version + 1,
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE id = ? AND recovery_code_hash = ? AND session_version = ?
    `
    )
      .bind(newPasswordHash, newRecoveryCodeHash, accountId, account.recovery_code_hash, account.session_version);

    // 新しいコードハッシュはこのリクエストだけの値。UPDATEが0行だった場合に
    // 別リクエストの認証設定まで消さないよう、後続DELETEも同じ値で条件付けする。
    const guard = "EXISTS (SELECT 1 FROM accounts WHERE id = ? AND recovery_code_hash = ? AND session_version = ?)";
    const values = [accountId, newRecoveryCodeHash, account.session_version + 1];
    const results = await env.DB.batch([
      reset,
      env.DB.prepare(`DELETE FROM account_passkeys WHERE account_id = ? AND ${guard}`).bind(accountId, ...values),
      env.DB.prepare(`DELETE FROM account_totp WHERE account_id = ? AND ${guard}`).bind(accountId, ...values),
      env.DB.prepare(`DELETE FROM account_auth_challenges WHERE account_id = ? AND ${guard}`).bind(accountId, ...values),
    ]);
    if (results[0].meta.changes !== 1) throw new AccountAuthError(INVALID_RECOVERY_ERROR);

    const responseBody: RecoverResponse = {
      success: true,
      recoveryCode: newRecoveryCode,
    };

    return authJson(responseBody, 200, [clearSessionCookie()]);
  }
);
