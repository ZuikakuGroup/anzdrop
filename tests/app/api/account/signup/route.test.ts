import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
import { vi } from "vitest";

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

async function postSignup(body: unknown) {
  const { POST } = await import("@/app/api/account/signup/route");

  return POST(
    new Request("http://localhost/api/account/signup", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/account/signup", () => {
  it("rejects an account id shorter than the minimum length", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "ab",
      password: "a-valid-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects an account id longer than the maximum length", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "a".repeat(33),
      password: "a-valid-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects an account id containing disallowed characters", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "not a valid id!",
      password: "a-valid-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a password shorter than the minimum length", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "valid-account-id",
      password: "short",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a password longer than the maximum length", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "valid-account-id",
      password: "a".repeat(201),
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
  });

  it("rejects the request when Turnstile verification fails", async () => {
    stubTurnstileFailure();
    const response = await postSignup({
      accountId: "valid-account-id",
      password: "a-valid-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);

    const { results } = await env.DB.prepare(`SELECT * FROM accounts`).all();
    expect(results).toHaveLength(0);
  });

  it("rejects the request when no Turnstile token is provided", async () => {
    const response = await postSignup({
      accountId: "valid-account-id",
      password: "a-valid-password",
    });

    expect(response.status).toBe(403);
  });

  it("rejects signup with an account id that is already taken, without touching the existing account", async () => {
    stubTurnstileSuccess();
    await insertTestAccount(env, {
      id: "already-taken",
      password: "original-password",
    });

    const response = await postSignup({
      accountId: "already-taken",
      password: "a-different-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(409);

    // 既存アカウントのパスワードが上書きされていないこと。
    const { POST: login } = await import("@/app/api/account/login/route");
    const loginResponse = await login(
      new Request("http://localhost/api/account/login", {
        method: "POST",
        body: JSON.stringify({
          accountId: "already-taken",
          password: "original-password",
          turnstileToken: "tok",
        }),
      })
    );
    expect(loginResponse.status).toBe(200);
  });

  it("creates a new free-plan account at the caller-chosen id with a hashed password on success", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "my-chosen-id",
      password: "a-valid-password",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);
    const body = await readJson<{
      success: boolean;
      accountId: string;
      recoveryCode: string;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.accountId).toBe("my-chosen-id");
    expect(typeof body.recoveryCode).toBe("string");

    const account = await env.DB.prepare(
      `SELECT plan, password_hash FROM accounts WHERE id = ?`
    )
      .bind(body.accountId)
      .first<{ plan: string; password_hash: string }>();

    expect(account?.plan).toBe("free");
    // 平文のパスワードがそのまま保存されていないこと。
    expect(account?.password_hash).not.toBe("a-valid-password");
    expect(account?.password_hash).not.toContain("a-valid-password");
  });

  it("creates an account that can actually be logged into with the same password (end-to-end)", async () => {
    stubTurnstileSuccess();
    const response = await postSignup({
      accountId: "roundtrip-id",
      password: "a-valid-password",
      turnstileToken: "tok",
    });
    const body = await readJson<{ accountId: string }>(response);

    const { POST: login } = await import("@/app/api/account/login/route");
    const loginResponse = await login(
      new Request("http://localhost/api/account/login", {
        method: "POST",
        body: JSON.stringify({
          accountId: body.accountId,
          password: "a-valid-password",
          turnstileToken: "tok",
        }),
      })
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("Set-Cookie")).toBeTruthy();
  });
});
