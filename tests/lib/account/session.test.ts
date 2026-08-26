import { describe, expect, it, vi } from "vitest";
import {
  createSessionCookie,
  clearSessionCookie,
  verifySession,
  SESSION_COOKIE_NAME,
} from "@/lib/account/session";

function envWithSessionVersion(sessionVersion: number | null) {
  const first = vi.fn(async () =>
    sessionVersion === null ? null : { session_version: sessionVersion }
  );
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    SESSION_SECRET: "test-secret-key-for-unit-tests",
    DB: { prepare } as unknown as CloudflareEnv["DB"],
  } as unknown as CloudflareEnv;
}

const ENV = envWithSessionVersion(0);

function requestWithCookie(cookieHeader: string | null): Request {
  const headers: Record<string, string> = {};

  if (cookieHeader !== null) {
    headers.cookie = cookieHeader;
  }

  return new Request("https://example.com/api/account/me", { headers });
}

function cookieValueFromSetCookie(setCookie: string): string {
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`));

  if (!match) {
    throw new Error("cookie not found in Set-Cookie header");
  }

  return match[1];
}

describe("createSessionCookie / verifySession", () => {
  it("round-trips the accountId through a real cookie header", async () => {
    const env = envWithSessionVersion(0);
    const setCookie = await createSessionCookie("acct_123", 0, env);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      env
    );

    expect(result).toEqual({ accountId: "acct_123" });
  });

  it("sets HttpOnly, Secure, and SameSite=Strict attributes", async () => {
    const setCookie = await createSessionCookie("acct_123", 0, ENV);

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("returns null when there is no cookie", async () => {
    await expect(
      verifySession(requestWithCookie(null), ENV)
    ).resolves.toBeNull();
  });

  it("returns null when SESSION_SECRET is not configured", async () => {
    const env = envWithSessionVersion(0);
    const setCookie = await createSessionCookie("acct_123", 0, env);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      {} as unknown as CloudflareEnv
    );

    expect(result).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const otherEnv = {
      ...envWithSessionVersion(0),
      SESSION_SECRET: "a-completely-different-secret",
    } as unknown as CloudflareEnv;
    const setCookie = await createSessionCookie("acct_123", 0, otherEnv);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      envWithSessionVersion(0)
    );

    expect(result).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const env = envWithSessionVersion(0);
    const setCookie = await createSessionCookie("acct_123", 0, env);
    const token = cookieValueFromSetCookie(setCookie);
    // 末尾1文字だけを反転すると、base64urlの未使用ビットの都合でデコード後の
    // バイト列が変わらないことがある(=検証をすり抜けてしまいテストが不安定に
    // なる)ため、シグネチャ部の中ほどの文字を反転させて確実に改変する。
    const midpoint = Math.floor(token.length / 2);
    const flippedChar = token[midpoint] === "A" ? "B" : "A";
    const tampered =
      token.slice(0, midpoint) + flippedChar + token.slice(midpoint + 1);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${tampered}`),
      env
    );

    expect(result).toBeNull();
  });

  it("returns null when the account no longer exists", async () => {
    const issuingEnv = envWithSessionVersion(0);
    const setCookie = await createSessionCookie("acct_123", 0, issuingEnv);
    const token = cookieValueFromSetCookie(setCookie);

    const verifyingEnv = envWithSessionVersion(null);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      verifyingEnv
    );

    expect(result).toBeNull();
  });

  it("returns null when the account's session_version no longer matches the token (revoked by password reset)", async () => {
    const issuingEnv = envWithSessionVersion(0);
    const setCookie = await createSessionCookie("acct_123", 0, issuingEnv);
    const token = cookieValueFromSetCookie(setCookie);

    // パスワード再設定でsession_versionが1にインクリメントされた後を想定。
    const verifyingEnv = envWithSessionVersion(1);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      verifyingEnv
    );

    expect(result).toBeNull();
  });

  it("accepts the token when session_version still matches", async () => {
    const env = envWithSessionVersion(2);
    const setCookie = await createSessionCookie("acct_123", 2, env);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      env
    );

    expect(result).toEqual({ accountId: "acct_123" });
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie immediately", () => {
    const setCookie = clearSessionCookie();

    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});
