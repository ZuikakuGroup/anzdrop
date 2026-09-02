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
import { verifyPassword } from "@/lib/account/password";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

// verifyPassword は既定では本物の実装をそのまま呼ぶ。並行リクエストの
// レースを決定的に再現したいテストだけ、この関数の内部でリクエストの
// 足並みを揃える(下記「concurrent failed attempts...」テストを参照)。
vi.mock("@/lib/account/password", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/account/password")>();

  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

let realVerifyPassword: typeof verifyPassword;

beforeAll(async () => {
  realVerifyPassword = (
    await vi.importActual<typeof import("@/lib/account/password")>(
      "@/lib/account/password"
    )
  ).verifyPassword;

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
      // 閾値ちょうど手前。2本同時に来ると両方 isLocked=false のスナップショットを
      // 見たうえで、片方が施錠したあともう片方が locked_until を上書きしようとする。
      failedLoginAttempts: 4,
    });

    // レースを決定的に再現する。試行枠の予約(reserveLoginAttempt)で
    // 6 を得たリクエストは verifyPassword に到達せず先に施錠する。
    // 5 を得たリクエストは verifyPassword まで進むので、そこで足を止め、
    // もう片方の施錠が DB に着地したことを確認してから解放する。これにより
    // 「後発リクエストが施錠済みの locked_until を上書きしようとする」
    // 経路を必ず通す。
    let releaseVerify!: () => void;
    const verifyGate = new Promise<void>((resolve) => {
      releaseVerify = resolve;
    });
    let verifyReached!: () => void;
    const verifyReachedPromise = new Promise<void>((resolve) => {
      verifyReached = resolve;
    });

    const verifySpy = vi.mocked(verifyPassword);
    verifySpy.mockImplementation(async (password, stored) => {
      verifyReached();
      await verifyGate;

      return realVerifyPassword(password, stored);
    });

    try {
      const pending = Promise.all([
        postLogin({ accountId, password: "wrong", turnstileToken: "tok" }),
        postLogin({ accountId, password: "wrong", turnstileToken: "tok" }),
      ]);

      // 閾値ちょうどのリクエストが verifyPassword で停止している。
      await verifyReachedPromise;

      // 閾値超えのリクエストは verifyPassword を経由せず施錠する。
      // その施錠が DB に反映されるまで待つ。
      await vi.waitFor(async () => {
        expect(
          (await getFailedLoginState(accountId)).locked_until
        ).not.toBeNull();
      });
      const lockedAfterFirst = (await getFailedLoginState(accountId))
        .locked_until;

      // ここで解放すると、停止していたリクエストが認証失敗後に lockAccount を
      // 呼ぶ。DB 上はすでにロック中なので WHERE ガードで 0 行更新になる。
      releaseVerify();
      await pending;

      const final = await getFailedLoginState(accountId);
      expect(final.locked_until).toBe(lockedAfterFirst);
      expect(final.failed_login_attempts).toBe(0);
    } finally {
      verifySpy.mockImplementation(realVerifyPassword);
    }

    // ロック中のさらなる誤試行でも locked_until は書き換わらない
    // (WHERE ガードの直接確認)。
    const before = await getFailedLoginState(accountId);
    await postLogin({ accountId, password: "wrong", turnstileToken: "tok" });
    const after = await getFailedLoginState(accountId);
    expect(after.locked_until).toBe(before.locked_until);
  });

  it("while locked, the correct password succeeds at the verify budget boundary but not past it", async () => {
    stubTurnstileSuccess();
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // LOCKOUT_VERIFY_BUDGET = LOGIN_LOCKOUT_THRESHOLD(5) * 4 = 20。
    // reserveLoginAttempt は照合前に +1 するので、開始値 19 → 予約後 20 で
    // ちょうど予算内、開始値 20 → 予約後 21 で予算超過になる。
    const atBoundary = await insertTestAccount(env, {
      password: "correct-password",
      lockedUntil,
      failedLoginAttempts: 19,
    });
    const boundaryResponse = await postLogin({
      accountId: atBoundary.accountId,
      password: atBoundary.password,
      turnstileToken: "tok",
    });
    expect(boundaryResponse.status).toBe(200);

    const pastBudget = await insertTestAccount(env, {
      password: "correct-password",
      lockedUntil,
      failedLoginAttempts: 20,
    });
    const pastResponse = await postLogin({
      accountId: pastBudget.accountId,
      password: pastBudget.password,
      turnstileToken: "tok",
    });
    expect(pastResponse.status).toBe(403);
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
