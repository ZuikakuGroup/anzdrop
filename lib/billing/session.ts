import { verifySession } from "@/lib/account/session";
import { verifySameOrigin } from "@/lib/access";

export async function requireBillingSession(request: Request, env: CloudflareEnv) {
  const session = await verifySession(request, env);
  if (!session) return { ok: false as const, response: Response.json(
    { success: false, error: "ログインが必要です" }, { status: 401 }
  ) };
  if (!verifySameOrigin(request, { allowMissing: false })) return { ok: false as const, response: Response.json(
    { success: false, error: "不正なオリジンからのリクエストです" }, { status: 403 }
  ) };
  return { ok: true as const, session };
}
