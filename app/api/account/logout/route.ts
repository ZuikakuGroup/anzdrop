import { clearSessionCookie } from "@/lib/account/session";

export async function POST(): Promise<Response> {
  return Response.json(
    { success: true },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}
