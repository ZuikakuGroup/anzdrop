import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/account/password";
import { createSessionCookie } from "@/lib/account/session";
import { verifyTurnstileToken } from "@/lib/turnstile";

type LoginRequest = {
  accountId: string;
  password: string;
  turnstileToken?: string;
};

type LoginResponse =
  | { success: true }
  | { success: false; error: string };

const INVALID_CREDENTIALS_ERROR = "Invalid account ID or password";
const ACCOUNT_LOCKED_ERROR = "Too many failed attempts. Please try again later.";

// アカウントIDを本人が自由に設定できるようになった結果、IDの予測不可能性に
// 頼れなくなったため、失敗回数によるロックアウトで総当たりを防ぐ。
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_DURATION_MS = 5 * 60 * 1000;

// 失敗回数をアトミックに1つ増やし、その結果(このリクエスト時点での通算値)を返す。
// パスワード照合(Argon2id、数十ms)より前にこれを行うことで、並行してリクエストが
// 飛んできた場合でも「閾値を超えた分は照合すら行わせない」形で保証を成立させる
// (パスワード照合後に増分する設計だと、複数リクエストが横並びで照合を終えてから
// 順番に増分するため、閾値を超えて何度もパスワードを試せてしまう)。
async function reserveLoginAttempt(
  env: CloudflareEnv,
  accountId: string
): Promise<number> {
  const updated = await env.DB.prepare(
    `
    UPDATE accounts
    SET failed_login_attempts = failed_login_attempts + 1
    WHERE id = ?
    RETURNING failed_login_attempts
  `
  )
    .bind(accountId)
    .first<{ failed_login_attempts: number }>();

  return updated?.failed_login_attempts ?? 0;
}

async function lockAccount(env: CloudflareEnv, accountId: string): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE accounts
    SET failed_login_attempts = 0, locked_until = ?
    WHERE id = ?
  `
  )
    .bind(
      new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MS).toISOString(),
      accountId
    )
    .run();
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as LoginRequest;
    const { accountId, password } = requestBody;

    if (typeof accountId !== "string" || typeof password !== "string") {
      return Response.json(
        { success: false, error: "Missing accountId or password" },
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
      `SELECT password_hash, session_version, locked_until FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(accountId)
      .first<{
        password_hash: string;
        session_version: number;
        locked_until: string | null;
      }>();

    if (account?.locked_until && new Date(account.locked_until) > new Date()) {
      return Response.json(
        { success: false, error: ACCOUNT_LOCKED_ERROR },
        { status: 403 }
      );
    }

    // 実際にパスワードを照合する前に試行枠を予約する。これにより、並行して
    // 飛んできた複数のリクエストがそれぞれ古い(ロック前の)状態を見て素通り
    // することがあっても、実際にパスワード照合まで進めるリクエスト数自体を
    // 閾値以下に抑えられる。
    const reservedAttempt = account
      ? await reserveLoginAttempt(env, accountId)
      : 0;

    if (account && reservedAttempt > LOGIN_LOCKOUT_THRESHOLD) {
      await lockAccount(env, accountId);

      return Response.json(
        { success: false, error: ACCOUNT_LOCKED_ERROR },
        { status: 403 }
      );
    }

    const passwordMatches = await verifyPassword(
      password,
      account?.password_hash ?? DUMMY_PASSWORD_HASH
    );

    if (!account || !passwordMatches) {
      if (account && reservedAttempt >= LOGIN_LOCKOUT_THRESHOLD) {
        await lockAccount(env, accountId);
      }

      return Response.json(
        { success: false, error: INVALID_CREDENTIALS_ERROR },
        { status: 403 }
      );
    }

    await env.DB.prepare(
      `UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
    )
      .bind(accountId)
      .run();

    const setCookie = await createSessionCookie(
      accountId,
      account.session_version,
      env
    );
    const responseBody: LoginResponse = { success: true };

    return Response.json(responseBody, {
      headers: { "Set-Cookie": setCookie },
    });
  } catch (error) {
    console.error("POST /api/account/login failed:", error);

    const responseBody: LoginResponse = {
      success: false,
      error: "Internal server error",
    };

    return Response.json(responseBody, { status: 500 });
  }
}
