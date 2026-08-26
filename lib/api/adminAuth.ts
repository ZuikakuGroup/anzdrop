import {
  verifyAccessJwt,
  verifySameOrigin,
  type AccessIdentity,
} from "@/lib/access";

export type AdminAuthResult =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; response: Response };

// app/api/admin/**の各ルートで手作業コピーされていた
// 「verifyAccessJwt→403 / verifySameOrigin→403」の定型をまとめる。
// 読み取り専用のGETルートは状態を変更しないためCSRFの対象にならず、
// verifySameOriginのチェックを省略できる(verifyOrigin: falseを渡す)。
export async function requireAdmin(
  request: Request,
  env: CloudflareEnv,
  options: { verifyOrigin?: boolean } = {}
): Promise<AdminAuthResult> {
  const { verifyOrigin = true } = options;

  const identity = await verifyAccessJwt(request, env);

  if (!identity) {
    return {
      ok: false,
      response: Response.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      ),
    };
  }

  if (verifyOrigin && !verifySameOrigin(request)) {
    return {
      ok: false,
      response: Response.json(
        { success: false, error: "Invalid origin" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, identity };
}
