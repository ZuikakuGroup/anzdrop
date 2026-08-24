import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessIdentity = {
  email: string;
};

const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_JWT_COOKIE = "CF_Authorization";

// createRemoteJWKSetは内部で鍵セットをキャッシュするが、リクエストごとに
// 新しいインスタンスを作るとそのキャッシュが効かず毎回JWKSを取得しに行って
// しまう。チームドメインが変わらない限りインスタンスを使い回す。
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedTeamDomain: string | null = null;

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks && cachedTeamDomain === teamDomain) {
    return cachedJwks;
  }

  cachedJwks = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
  );
  cachedTeamDomain = teamDomain;

  return cachedJwks;
}

function extractCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

// Cloudflare Accessは/admin*向けのリクエストをエッジで既に認証済みだが、
// Access側の設定ミスでその関門が働かなかった場合にオリジン側でも
// 拒否できるようにする多層防御。あくまで補助であり、主たる関門は
// Cloudflare Access自体(Zero Trustダッシュボード側の設定)。
export async function verifyAccessJwt(
  request: Request,
  env: CloudflareEnv
): Promise<AccessIdentity | null> {
  const token =
    request.headers.get(ACCESS_JWT_HEADER) ??
    extractCookie(request.headers.get("cookie"), ACCESS_JWT_COOKIE);

  if (!token) {
    return null;
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;

  if (!teamDomain || !aud) {
    return null;
  }

  try {
    const jwks = getJwks(teamDomain);

    const { payload } = await jwtVerify(token, jwks, {
      audience: aud,
    });

    const email = typeof payload.email === "string" ? payload.email : null;

    if (!email) {
      return null;
    }

    return { email };
  } catch {
    return null;
  }
}
