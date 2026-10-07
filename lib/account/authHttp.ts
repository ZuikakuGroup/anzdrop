import { getCloudflareContext } from "@opennextjs/cloudflare";

export class AccountAuthError extends Error {
  constructor(message = "認証に失敗しました。もう一度お試しください。", readonly status = 403) { super(message); }
}

export function authJson(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

// 認証ライブラリの例外は入力や秘密を含む可能性があるため、例外内容をログに出さない。
export function withAccountAuthHandler(label: string, handler: (request: Request, env: CloudflareEnv) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      const response = await handler(request, getCloudflareContext().env);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof AccountAuthError) return authJson({ success: false, error: error.message }, error.status);
      console.error(`${label}: account authentication failed`);
      return authJson({ success: false, error: "サーバー内部でエラーが発生しました" }, 500);
    }
  };
}

export function webauthnSite(): { rpID: string; origin: string } {
  // 本番は任意のHostやOriginヘッダーから認証先を決めない。
  if (process.env.DEPLOYMENT_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.ACCOUNT_AUTH_LOCAL_ORIGIN)) {
    return { rpID: "anzdrop.com", origin: "https://anzdrop.com" };
  }
  const origin = process.env.ACCOUNT_AUTH_LOCAL_ORIGIN ?? "http://localhost:3000";
  const url = new URL(origin);
  if (url.hostname !== "localhost" || url.origin !== origin || url.protocol !== "http:") throw new Error("Invalid local WebAuthn origin");
  // ACCOUNT_AUTH_LOCAL_ORIGINはビルド成果物のworkerdローカル検証専用。
  // リモート環境では配置せず、本番Originに固定する。
  return { rpID: "localhost", origin };
}

export function requireAuthOrigin(request: Request): void {
  if (request.headers.get("origin") !== webauthnSite().origin) throw new AccountAuthError("この送信元からは認証できません。");
}
