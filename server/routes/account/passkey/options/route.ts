import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { requireTurnstile } from "@/lib/turnstile";
import { withAccountAuthHandler, authJson, requireAuthOrigin } from "@/lib/account/authHttp";
import { authenticationOptions } from "@/lib/account/passkeys";
import { createAuthChallenge, PASSKEY_LOGIN_COOKIE } from "@/lib/account/securityStore";

export const POST = withAccountAuthHandler("POST /api/account/passkey/options", async (request, env) => {
  requireAuthOrigin(request);
  const parsed = await parseJsonBody(request, z.object({ turnstileToken: z.string().optional() }));
  if (!parsed.ok) return parsed.response;
  const turnstile = await requireTurnstile(parsed.data.turnstileToken, env.TURNSTILE_SECRET_KEY);
  if (!turnstile.ok) return turnstile.response;
  const options = await authenticationOptions();
  const cookie = await createAuthChallenge(env, request, PASSKEY_LOGIN_COOKIE, {
    account_id: null, session_version: null, purpose: "passkey-login", action: null,
    target_id: null, payload: null, challenge: options.challenge,
  });
  return authJson({ success: true, options }, 200, [cookie]);
});
