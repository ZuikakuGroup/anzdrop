import { SignJWT, jwtVerify } from "jose";
import { extractCookie, buildSetCookie } from "@/lib/cookie";

export type SessionIdentity = {
  accountId: string;
};

export const SESSION_COOKIE_NAME = "anzdrop_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30日

function getSecretKey(env: CloudflareEnv): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function createSessionCookie(
  accountId: string,
  env: CloudflareEnv
): Promise<string> {
  const token = await new SignJWT({ accountId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey(env));

  return buildSetCookie(SESSION_COOKIE_NAME, token, SESSION_DURATION_SECONDS);
}

export function clearSessionCookie(): string {
  return buildSetCookie(SESSION_COOKIE_NAME, "", 0);
}

// lib/access.tsのverifyAccessJwtと同様、失敗時は例外を投げず必ずnullを返す。
export async function verifySession(
  request: Request,
  env: CloudflareEnv
): Promise<SessionIdentity | null> {
  const token = extractCookie(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME
  );

  if (!token || !env.SESSION_SECRET) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(env));
    const accountId =
      typeof payload.accountId === "string" ? payload.accountId : null;

    if (!accountId) {
      return null;
    }

    return { accountId };
  } catch {
    return null;
  }
}
