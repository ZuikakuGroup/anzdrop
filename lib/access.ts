import { createRemoteJWKSet, jwtVerify } from "jose";
import { extractCookie } from "@/lib/cookie";

export type AccessIdentity = {
  email: string;
};

const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_JWT_COOKIE = "CF_Authorization";
const LOCAL_ADMIN_BYPASS_ENV = "LOCAL_ADMIN_BYPASS";
const LOCAL_ADMIN_IDENTITY: AccessIdentity = { email: "local-admin@localhost" };

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

function isLocalHost(host: string | null): boolean {
  if (!host) {
    return false;
  }

  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// ローカルで管理画面のUIを確認するための明示的な開発専用バイパス。
// 本番/PreviewではNODE_ENVがdevelopmentでないため、環境変数が誤って設定
// されても有効にならない。さらにlocalhostからのリクエストに限定する。
function canBypassAccessForLocalDevelopment(headers: Headers): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env[LOCAL_ADMIN_BYPASS_ENV] === "true" &&
    isLocalHost(headers.get("host"))
  );
}

// Cloudflare Accessは/admin*向けのリクエストをエッジで既に認証済みだが、
// Access側の設定ミスでその関門が働かなかった場合にオリジン側でも
// 拒否できるようにする多層防御。あくまで補助であり、主たる関門は
// Cloudflare Access自体(Zero Trustダッシュボード側の設定)。
export async function verifyAccessJwt(
  headers: Headers,
  env: CloudflareEnv
): Promise<AccessIdentity | null> {
  if (canBypassAccessForLocalDevelopment(headers)) {
    return LOCAL_ADMIN_IDENTITY;
  }

  const token =
    headers.get(ACCESS_JWT_HEADER) ??
    extractCookie(headers.get("cookie"), ACCESS_JWT_COOKIE);

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

// Cookieを伴う状態変更APIのCSRF対策。ブラウザはPOST等のクロスオリジン操作に
// Originを送るため、欠落も含めて拒否する。管理APIはCloudflare Accessを主認証と
// するため、既存の非ブラウザ運用を維持する必要がある箇所だけallowMissingを使う。
export function verifySameOrigin(
  request: Request,
  { allowMissing = true }: { allowMissing?: boolean } = {}
): boolean {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return allowMissing;
  }

  return origin === new URL(request.url).origin;
}
