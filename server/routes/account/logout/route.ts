import { clearSessionCookie } from "@/lib/account/session";
import { verifySameOrigin } from "@/lib/access";

export async function POST(request: Request): Promise<Response> {
  if (!verifySameOrigin(request, { allowMissing: false })) {
    return Response.json(
      { success: false, error: "不正なオリジンからのリクエストです" },
      { status: 403 }
    );
  }

  return Response.json(
    { success: true },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}
