import {
  afterAll,
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
  readJson,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

let forceContextError = false;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (forceContextError) {
      throw new Error("boom: unexpected internal failure");
    }

    return { env };
  },
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

describe("GET /api/account/me", () => {
  it("returns 401 when there is no session cookie", async () => {
    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(new Request("http://localhost/api/account/me"));

    expect(response.status).toBe(401);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);
  });

  it("returns the account's plan when a valid session cookie is present", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    const cookie = await sessionCookieHeader(env, accountId);

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      accountId,
      plan: "free",
      planExpiresAt: null,
    });
  });

  it("returns the account's plan and expiry for a premium account (not just the free default)", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: future,
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie },
      })
    );

    expect(response.status).toBe(200);
    const body = await readJson<{
      success: boolean;
      accountId: string;
      plan: string;
      planExpiresAt: string | null;
    }>(response);
    expect(body).toEqual({
      success: true,
      accountId,
      plan: "premium",
      planExpiresAt: future,
    });
  });

  it("returns 'standard' for a standard-plan account", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: future,
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie },
      })
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ plan: string }>(response);
    expect(body.plan).toBe("standard");
  });

  it("returns 'premium' for a legacy 'paid' DB value (backward compatibility)", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "paid",
      planExpiresAt: future,
    });
    const cookie = await sessionCookieHeader(env, accountId);

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie },
      })
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ plan: string }>(response);
    expect(body.plan).toBe("premium");
  });

  it("returns 401 for a session cookie referencing a non-existent account", async () => {
    const cookie = await sessionCookieHeader(env, "no-such-account-id");

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie },
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 for a tampered session cookie", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    // base64url文字列の末尾1文字は、全体の長さによっては実データに
    // 対応しないビットを含むことがあり、末尾だけを変えても復号結果が
    // 変わらずデコードが偶然成功してしまうことがある(フレーキーの原因に
    // なっていた)。中央付近の文字を変えれば必ずデコード結果が変わる。
    const midIndex = Math.floor(cookie.length / 2);
    const midChar = cookie[midIndex];
    const replacement = midChar === "a" ? "b" : "a";
    const tampered =
      cookie.slice(0, midIndex) + replacement + cookie.slice(midIndex + 1);

    const { GET } = await import("@/app/api/account/me/route");
    const response = await GET(
      new Request("http://localhost/api/account/me", {
        headers: { cookie: tampered },
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns a generic 500 (without leaking internal error details) on unexpected failure", async () => {
    forceContextError = true;

    try {
      const { GET } = await import("@/app/api/account/me/route");
      const response = await GET(
        new Request("http://localhost/api/account/me")
      );

      expect(response.status).toBe(500);
      const body = await readJson<{ success: boolean; error: string }>(
        response
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe("サーバー内部でエラーが発生しました");
    } finally {
      forceContextError = false;
    }
  });
});
