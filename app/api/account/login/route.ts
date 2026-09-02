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

// ロック中でも本人(正しいパスワード)は通す(標的型ロックアウト嫌がらせの
// 緩和。GitHub issue #66)が、ロック期間内の試行がこの回数を超えたら
// パスワード照合はダミーだけにして 403 にする。人間が数回リトライするぶんには
// 通し、自動化された総当たりはロック期間内で頭打ちにするためのしきい値。
const LOCKOUT_VERIFY_BUDGET = LOGIN_LOCKOUT_THRESHOLD * 4;

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

    const invalidCredentials = (): Response =>
      Response.json(
        { success: false, error: INVALID_CREDENTIALS_ERROR },
        { status: 403 }
      );

    const isLocked =
      !!account?.locked_until && new Date(account.locked_until) > new Date();

    // ロック期限が過ぎていたら、ロック期間内に積み上がった失敗カウンタごと
    // クリアしてから通常のフローに入る(そうしないと、ロック明け1発目の
    // 正しいパスワードが「閾値超過」で弾かれてしまう)。
    if (account && account.locked_until && !isLocked) {
      await env.DB.prepare(
        `UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
      )
        .bind(accountId)
        .run();
    }

    // 実際にパスワードを照合する前に試行枠を予約する(照合前に増分)。
    // 並行して飛んできた複数のリクエストがそれぞれ古い状態を見て素通りしても、
    // 実際に照合まで進むリクエスト数自体を閾値以下に抑えられる。lockAccount は
    // 施錠時に failed_login_attempts を 0 にするので、ロック中はこの値が
    // 「ロック期間内での試行回数」になる。
    const reservedAttempt = account
      ? await reserveLoginAttempt(env, accountId)
      : 0;

    // ロックしていない状態で閾値を超えた並行リクエストは、照合前に弾いて施錠する。
    if (account && !isLocked && reservedAttempt > LOGIN_LOCKOUT_THRESHOLD) {
      await lockAccount(env, accountId);
      return invalidCredentials();
    }

    // ロック中でも、正しいパスワードを提示できる本人はログインを通す
    // (標的型ロックアウト嫌がらせの緩和。GitHub issue #66)。ただしロック期間内の
    // 試行が LOCKOUT_VERIFY_BUDGET を超えたら(自動化された総当たり)、以降は
    // 本物のハッシュに対する照合をやめて 403 にする。応答時間を通常の失敗と
    // 揃えるため、ここでもダミーの照合は行う。ロック期間自体は延長しない
    // (延長すると嫌がらせでロックが伸び続けてしまう)。
    const lockoutBudgetExhausted =
      isLocked && reservedAttempt > LOCKOUT_VERIFY_BUDGET;

    const canCheckRealPassword = !!account && !lockoutBudgetExhausted;

    const passwordMatches = await verifyPassword(
      password,
      canCheckRealPassword
        ? (account as { password_hash: string }).password_hash
        : DUMMY_PASSWORD_HASH
    );

    if (account && canCheckRealPassword && passwordMatches) {
      return grantSession(env, accountId, account.session_version);
    }

    // 認証失敗。ロックしていない状態で閾値に達したら新規に施錠する
    // (ロック中は施錠し直さない — failed_login_attempts が 0 に戻り
    //  ロック期間内の試行枠がリセットされてしまうため)。
    if (
      account &&
      !isLocked &&
      reservedAttempt >= LOGIN_LOCKOUT_THRESHOLD
    ) {
      await lockAccount(env, accountId);
    }

    return invalidCredentials();
  }
);
