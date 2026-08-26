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
  sessionCookieHeader,
  stubTurnstileSuccess,
  stubTurnstileFailure,
  readJson,
  type TestEnv,
} from "@/test/env";

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

async function postRecover(body: unknown) {
  const { POST } = await import("./route");

  return POST(
    new Request("http://localhost/api/account/recover", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/account/recover", () => {
  it("rejects a request with a too-short new password", async () => {
    const response = await postRecover({
      accountId: "x",
      recoveryCode: "y",
      newPassword: "short",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects the request when Turnstile verification fails", async () => {
    stubTurnstileFailure();
    const { accountId, recoveryCode } = await insertTestAccount(env);

    const response = await postRecover({
      accountId,
      recoveryCode,
      newPassword: "brand-new-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
  });

  it("rejects an incorrect recovery code with the same status/message as an unknown account", async () => {
    stubTurnstileSuccess();
    const { accountId } = await insertTestAccount(env, {
      recoveryCode: "correct-recovery-code",
    });

    const wrongCode = await postRecover({
      accountId,
      recoveryCode: "wrong-code",
      newPassword: "brand-new-password",
      turnstileToken: "tok",
    });
    const unknownAccount = await postRecover({
      accountId: "no-such-account",
      recoveryCode: "whatever",
      newPassword: "brand-new-password",
      turnstileToken: "tok",
    });

    expect(wrongCode.status).toBe(403);
    expect(unknownAccount.status).toBe(403);
    expect((await readJson<{ error: string }>(wrongCode)).error).toBe(
      (await readJson<{ error: string }>(unknownAccount)).error
    );
  });

  it("rotates the password and recovery code, and invalidates existing sessions issued before the reset", async () => {
    stubTurnstileSuccess();
    const { accountId, recoveryCode } = await insertTestAccount(env, {
      password: "old-password",
    });

    // 再設定より前に発行されたセッション。
    const oldSessionCookie = await sessionCookieHeader(env, accountId);

    const response = await postRecover({
      accountId,
      recoveryCode,
      newPassword: "brand-new-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
    const body = await readJson<{ recoveryCode: string }>(response);
    expect(typeof body.recoveryCode).toBe("string");
    expect(body.recoveryCode).not.toBe(recoveryCode);

    // 再設定前のセッションCookieはもう使えない。
    const { GET } = await import("@/app/api/account/me/route");
    const meWithOldSession = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie: oldSessionCookie },
      })
    );
    expect(meWithOldSession.status).toBe(401);

    // 古いパスワードではもうログインできない。
    const { POST: login } = await import("@/app/api/account/login/route");
    const loginWithOldPassword = await login(
      new Request("http://localhost/api/account/login", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          password: "old-password",
          turnstileToken: "tok",
        }),
      })
    );
    expect(loginWithOldPassword.status).toBe(403);

    // 新しいパスワードでログインできる。
    const loginWithNewPassword = await login(
      new Request("http://localhost/api/account/login", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          password: "brand-new-password",
          turnstileToken: "tok",
        }),
      })
    );
    expect(loginWithNewPassword.status).toBe(200);

    // 使い捨てのリカバリーコードも既に無効(再利用できない)。
    const reuseOldRecoveryCode = await postRecover({
      accountId,
      recoveryCode,
      newPassword: "yet-another-password",
      turnstileToken: "tok",
    });
    expect(reuseOldRecoveryCode.status).toBe(403);
  });
});
