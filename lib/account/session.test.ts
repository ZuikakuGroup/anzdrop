import { describe, expect, it } from "vitest";
import {
  createSessionCookie,
  clearSessionCookie,
  verifySession,
  SESSION_COOKIE_NAME,
} from "./session";

const ENV = { SESSION_SECRET: "test-secret-key-for-unit-tests" } as unknown as CloudflareEnv;

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
    const setCookie = await createSessionCookie("acct_123", ENV);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      ENV
    );

    expect(result).toEqual({ accountId: "acct_123" });
  });

  it("sets HttpOnly, Secure, and SameSite=Strict attributes", async () => {
    const setCookie = await createSessionCookie("acct_123", ENV);

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("returns null when there is no cookie", async () => {
    await expect(verifySession(requestWithCookie(null), ENV)).resolves.toBeNull();
  });

  it("returns null when SESSION_SECRET is not configured", async () => {
    const setCookie = await createSessionCookie("acct_123", ENV);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      {} as unknown as CloudflareEnv
    );

    expect(result).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const otherEnv = { SESSION_SECRET: "a-completely-different-secret" } as unknown as CloudflareEnv;
    const setCookie = await createSessionCookie("acct_123", otherEnv);
    const token = cookieValueFromSetCookie(setCookie);

    const result = await verifySession(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      ENV
    );

    expect(result).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const setCookie = await createSessionCookie("acct_123", ENV);
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
      ENV
    );

    expect(result).toBeNull();
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie immediately", () => {
    const setCookie = clearSessionCookie();

    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});
