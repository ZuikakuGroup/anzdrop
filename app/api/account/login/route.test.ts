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
  const { POST } = await import("./route");

  return POST(
    new Request("http://localhost/api/account/login", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
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
});
