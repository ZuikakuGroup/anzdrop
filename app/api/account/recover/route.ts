import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateRecoveryCode } from "@/lib/account/id";
import { hashPassword, verifyPassword } from "@/lib/account/password";
import { verifyTurnstileToken } from "@/lib/turnstile";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

type RecoverRequest = {
  accountId: string;
  recoveryCode: string;
  newPassword: string;
  turnstileToken?: string;
};

type RecoverResponse =
  | { success: true; recoveryCode: string }
  | { success: false; error: string };

const INVALID_RECOVERY_ERROR = "Invalid account ID or recovery code";

// ログインと同様、アカウント不在時もタイミングを揃えるためのダミーハッシュ。
const DUMMY_HASH =
  "210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as RecoverRequest;
    const { accountId, recoveryCode, newPassword } = requestBody;

    if (
      typeof accountId !== "string" ||
      typeof recoveryCode !== "string" ||
      typeof newPassword !== "string" ||
      newPassword.length < MIN_PASSWORD_LENGTH ||
      newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      return Response.json(
        { success: false, error: "Invalid request" },
        { status: 400 }
      );
    }

    const verification = await verifyTurnstileToken(
      requestBody.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!verification.success) {
      return Response.json(
        { success: false, error: "Turnstile verification failed" },
        { status: 403 }
      );
    }

    const account = await env.DB.prepare(
      `SELECT recovery_code_hash FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(accountId)
      .first<{ recovery_code_hash: string }>();

    const recoveryCodeMatches = await verifyPassword(
      recoveryCode,
      account?.recovery_code_hash ?? DUMMY_HASH
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
  } catch (error) {
    const responseBody: RecoverResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
