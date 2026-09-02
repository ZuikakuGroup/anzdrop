import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestEnv,
  clearAllTables,
  insertTestAccount,
  stubTurnstileSuccess,
  stubTurnstileFailure,
  readJson,
  type TestEnv,
} from "@/test/env";
import { SESSION_COOKIE_NAME } from "@/lib/account/session";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

beforeAll(async () => {
  const handle = await createTestEnv();
  env = handle.env;
  dispose = handle.dispose;
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await clearAllTables(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postLogin(body: unknown) {
  const { POST } = await import("@/app/api/account/login/route");

  return POST(
    new Request("http://localhost/api/account/login", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

async function getFailedLoginState(
  accountId: string
): Promise<{ failed_login_attempts: number; locked_until: string | null }> {
  const row = await env.DB.prepare(
    `SELECT failed_login_attempts, locked_until FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{ failed_login_attempts: number; locked_until: string | null }>();

  return row!;
}

describe("POST /api/account/login", () => {
  it("rejects a request missing accountId or password", async () => {
    const response = await postLogin({ accountId: "x" });

    expect(response.status).toBe(400);
  });

  it("rejects the request when Turnstile verification fails", async () => {
    stubTurnstileFailure();
    const { accountId, password } = await insertTestAccount(env);

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
  });

  it("rejects an incorrect password with the same status/message as an unknown account (no user enumeration)", async () => {
    stubTurnstileSuccess();
    const { accountId } = await insertTestAccount(env, {
      password: "correct-password",
    });

    const wrongPassword = await postLogin({
      accountId,
      password: "wrong-password",
      turnstileToken: "tok",
    });
    const unknownAccount = await postLogin({
      accountId: "no-such-account-id",
      password: "whatever",
      turnstileToken: "tok",
    });

    expect(wrongPassword.status).toBe(unknownAccount.status);
    expect(wrongPassword.status).toBe(403);

    const wrongBody = await readJson<{ error: string }>(wrongPassword);
    const unknownBody = await readJson<{ error: string }>(unknownAccount);
    expect(wrongBody.error).toBe(unknownBody.error);
  });

  it("issues a valid session cookie on successful login", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env);

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");

    // ロックアウト用の内部カウンタはレスポンスに含まれない。
    const body = await readJson<Record<string, unknown>>(response);
    expect(body).not.toHaveProperty("failed_login_attempts");
    expect(body).not.toHaveProperty("locked_until");

    // 発行されたCookieが/api/account/meで実際に有効であることまで確認する。
    const cookieValue = setCookie!.split(";")[0];
    const { GET } = await import("@/app/api/account/me/route");
    const meResponse = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie: cookieValue },
      })
    );

    expect(meResponse.status).toBe(200);
    const meBody = await readJson<{ accountId: string }>(meResponse);
    expect(meBody.accountId).toBe(accountId);
  });

  it("returns a generic 500 (without leaking internal error details) when SESSION_SECRET is not configured", async () => {
    // 本番でSESSION_SECRETがCloudflare Workersのシークレットとして未設定の
    // まま運用されていたことがあり、ログイン成功後のセッションCookie発行
    // (createSessionCookie)がWebCryptoの生のエラー("Imported HMAC key
    // length (0)...")を投げ、それがそのままレスポンスに漏れていた。
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env);

    const originalSecret = env.SESSION_SECRET;
    env.SESSION_SECRET = "";

    try {
      const response = await postLogin({
        accountId,
        password,
        turnstileToken: "tok",
      });

      expect(response.status).toBe(500);
      const body = await readJson<{ success: boolean; error: string }>(
        response
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe("サーバー内部でエラーが発生しました");
    } finally {
      env.SESSION_SECRET = originalSecret;
    }
  });

  it("increments failed_login_attempts on a wrong password and resets it on a subsequent success", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env, {
      password: "correct-password",
    });

    await postLogin({ accountId, password: "wrong", turnstileToken: "tok" });
    await postLogin({ accountId, password: "wrong", turnstileToken: "tok" });

    expect((await getFailedLoginState(accountId)).failed_login_attempts).toBe(
      2
    );

    const success = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });
    expect(success.status).toBe(200);

    const state = await getFailedLoginState(accountId);
    expect(state.failed_login_attempts).toBe(0);
    expect(state.locked_until).toBeNull();
  });

  it("does not lock after only 4 failed attempts; the 5th attempt still succeeds with the correct password", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env, {
      password: "correct-password",
    });

    for (let i = 0; i < 4; i++) {
      const response = await postLogin({
        accountId,
        password: "wrong",
        turnstileToken: "tok",
      });
      expect(response.status).toBe(403);
    }

    expect((await getFailedLoginState(accountId)).locked_until).toBeNull();

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });
    expect(response.status).toBe(200);
  });

  it("locks the account after 5 consecutive failed attempts", async () => {
    stubTurnstileSuccess();
    const { accountId } = await insertTestAccount(env, {
      password: "correct-password",
    });

    for (let i = 0; i < 5; i++) {
      const response = await postLogin({
        accountId,
        password: "wrong",
        turnstileToken: "tok",
      });
      expect(response.status).toBe(403);
    }

    const state = await getFailedLoginState(accountId);
    expect(state.failed_login_attempts).toBe(0);
    expect(state.locked_until).not.toBeNull();
    expect(new Date(state.locked_until!).getTime()).toBeGreaterThan(
      Date.now()
    );
  });

  it("while locked, rejects a wrong password without a distinguishable response, and never extends the lock", async () => {
    stubTurnstileSuccess();
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      password: "correct-password",
      lockedUntil,
      failedLoginAttempts: 0,
    });

    const lockedWrong = await postLogin({
      accountId,
      password: "wrong",
      turnstileToken: "tok",
    });
    const unknownAccount = await postLogin({
      accountId: "no-such-account-id",
      password: "whatever",
      turnstileToken: "tok",
    });

    expect(lockedWrong.status).toBe(403);
    expect(lockedWrong.status).toBe(unknownAccount.status);
    expect((await readJson<{ error: string }>(lockedWrong)).error).toBe(
      (await readJson<{ error: string }>(unknownAccount)).error
    );

    // ロック期限は1バイトも変わらない(嫌がらせでロックが延び続けない)。
    const state = await getFailedLoginState(accountId);
    expect(state.locked_until).toBe(lockedUntil);
    // ロック期間内の試行としてカウントはされる(タイミングを通常の失敗と
    // 揃えるための DB write が走っている証跡)。
    expect(state.failed_login_attempts).toBe(1);
  });

  it("concurrent failed attempts that both cross the threshold do not extend the lock past the first", async () => {
    stubTurnstileSuccess();
    const { accountId } = await insertTestAccount(env, {
      password: "correct-password",
      // 閾値ちょうど手前。2本同時に来ると両方 isLocked=false を見て閾値を超える。
      failedLoginAttempts: 4,
    });

    await Promise.all([
      postLogin({ accountId, password: "wrong", turnstileToken: "tok" }),
      postLogin({ accountId, password: "wrong", turnstileToken: "tok" }),
    ]);

    const first = await getFailedLoginState(accountId);
    expect(first.locked_until).not.toBeNull();

    // さらにもう1本の誤った試行(ロック中)。lockAccount の WHERE ガードにより
    // locked_until は書き換わらない。
    await postLogin({ accountId, password: "wrong", turnstileToken: "tok" });
    const second = await getFailedLoginState(accountId);
    expect(second.locked_until).toBe(first.locked_until);
  });

  it("while locked, once too many attempts are made, even the correct password is rejected (bounded brute-force)", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env, {
      password: "correct-password",
      lockedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      // ロック期間内の試行枠(LOGIN_LOCKOUT_THRESHOLD * 4 = 20)を使い切った状態。
      failedLoginAttempts: 25,
    });

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);

    // ロック期限が過ぎれば、正しいパスワードは(カウンタが大きくても)通る。
    await env.DB.prepare(
      `UPDATE accounts SET locked_until = ? WHERE id = ?`
    )
      .bind(new Date(Date.now() - 1000).toISOString(), accountId)
      .run();

    const afterExpiry = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });
    expect(afterExpiry.status).toBe(200);
  });

  it("while locked, lets the real owner in with the correct password and clears the lock (#66 targeted-lockout mitigation)", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env, {
      password: "correct-password",
      lockedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      failedLoginAttempts: 0,
    });

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(
      `${SESSION_COOKIE_NAME}=`
    );

    const state = await getFailedLoginState(accountId);
    expect(state.failed_login_attempts).toBe(0);
    expect(state.locked_until).toBeNull();
  });

  it("allows login again once the lockout window has passed", async () => {
    stubTurnstileSuccess();
    const { accountId, password } = await insertTestAccount(env, {
      password: "correct-password",
      // 既に過去の時刻でロックされている状態を直接作る(5分待たずに検証するため)。
      lockedUntil: new Date(Date.now() - 1000).toISOString(),
      failedLoginAttempts: 0,
    });

    const response = await postLogin({
      accountId,
      password,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
  });
});
