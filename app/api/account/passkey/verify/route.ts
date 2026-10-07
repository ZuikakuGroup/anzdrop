import { z } from "zod";
import { buildSetCookie } from "@/lib/cookie";
import { parseJsonBody } from "@/lib/api/validate";
import { withAccountAuthHandler, requireAuthOrigin } from "@/lib/account/authHttp";
import { AuthenticationSchema, verifyPasskey } from "@/lib/account/passkeys";
import { grantAccountSession } from "@/lib/account/grantSession";
import { readAuthChallenge, consumeAuthChallenge, PASSKEY_LOGIN_COOKIE } from "@/lib/account/securityStore";

export const POST = withAccountAuthHandler("POST /api/account/passkey/verify", async (request, env) => {
  requireAuthOrigin(request);
  const parsed = await parseJsonBody(request, z.object({ response: AuthenticationSchema }));
  if (!parsed.ok) return parsed.response;
  const challenge = await readAuthChallenge(env, request, PASSKEY_LOGIN_COOKIE, "passkey-login");
  const account = await verifyPasskey(env, challenge, parsed.data.response);
  await consumeAuthChallenge(env, challenge);
  return grantAccountSession(env, account.id, account.session_version, false, [buildSetCookie(PASSKEY_LOGIN_COOKIE, "", 0)]);
});
