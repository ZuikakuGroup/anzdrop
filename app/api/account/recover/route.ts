import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateRecoveryCode } from "@/lib/account/id";
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from "@/lib/account/password";
import { requireTurnstile } from "@/lib/turnstile";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  RecoverRequestSchema,
  type RecoverResponse,
} from "@/app/api/account/recover/schema";

const INVALID_RECOVERY_ERROR = "Invalid account ID or recovery code";

export const POST = withApiHandler(
  "POST /api/account/recover",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

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
      `SELECT recovery_code_hash FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(accountId)
      .first<{ recovery_code_hash: string }>();

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
    await env.DB.prepare(
      `
      UPDATE accounts
      SET password_hash = ?,
          recovery_code_hash = ?,
          session_version = session_version + 1,
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE id = ?
    `
    )
      .bind(newPasswordHash, newRecoveryCodeHash, accountId)
      .run();

    const responseBody: RecoverResponse = {
      success: true,
      recoveryCode: newRecoveryCode,
    };

    return Response.json(responseBody);
  }
);
