import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/account/password";
import { createSessionCookie } from "@/lib/account/session";
import { requireTurnstile } from "@/lib/turnstile";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  LoginRequestSchema,
  type LoginResponse,
} from "@/app/api/account/login/schema";

const INVALID_CREDENTIALS_ERROR = "アカウントIDまたはパスワードが正しくありません";

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

// ログイン成功時の共通処理。失敗カウンタ・ロックをリセットし、セッション
// Cookie を発行する。
async function grantSession(
  env: CloudflareEnv,
  accountId: string,
  sessionVersion: number
): Promise<Response> {
  await env.DB.prepare(
    `UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
  )
    .bind(accountId)
    .run();

  const setCookie = await createSessionCookie(accountId, sessionVersion, env);
  const responseBody: LoginResponse = { success: true };

  return Response.json(responseBody, {
    headers: { "Set-Cookie": setCookie },
  });
}

export const POST = withApiHandler(
  "POST /api/account/login",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, LoginRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { accountId, password } = parsed.data;

    const turnstile = await requireTurnstile(
      parsed.data.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!turnstile.ok) {
      return turnstile.response;
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

    // ロック中の応答も、通常の認証失敗と同じメッセージ・ステータス・応答時間
    // (Argon2id 照合を伴う)にする。失敗回数によるロックは実在アカウントにしか
    // 起きないため、違いがあるとアカウントIDの実在を判別できてしまう
    // (user enumeration)。
    //
    // ただしロック中でも、正しいパスワードを提示できる本人はログインを通す。
    // アカウントIDは本人が自由に決める公開されうる文字列なので、第三者が
    // 対象IDへ誤ったパスワードを連打するだけで正規ユーザーを継続的に締め出せる
    // (標的型ロックアウト嫌がらせ)。これを緩和する。総当たりに対する主たる
    // 防御は Turnstile 必須(1回ごとにトークンが必要)+ Argon2id であり、
    // ロックはあくまで補助。誤ったパスワードはロック中も 403 で、ロックと
    // 失敗カウンタはそのまま残す(時間経過で自然に解除される)。GitHub issue #66。
    if (
      account?.locked_until &&
      new Date(account.locked_until) > new Date()
    ) {
      const passwordMatches = await verifyPassword(
        password,
        account.password_hash
      );

      if (passwordMatches) {
        return grantSession(env, accountId, account.session_version);
      }

      return Response.json(
        { success: false, error: INVALID_CREDENTIALS_ERROR },
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
        { success: false, error: INVALID_CREDENTIALS_ERROR },
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

    return grantSession(env, accountId, account.session_version);
  }
);
