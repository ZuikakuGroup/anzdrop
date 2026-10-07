import { parseJsonBody } from "@/lib/api/validate";
import { LoginRequestSchema } from "@/app/api/account/login/schema";
import { authenticateAccountPassword } from "@/lib/account/passwordAuthentication";
import { grantAccountSession } from "@/lib/account/grantSession";
import { withAccountAuthHandler, authJson } from "@/lib/account/authHttp";
import { createAuthChallenge, OTP_LOGIN_COOKIE } from "@/lib/account/securityStore";

export const POST = withAccountAuthHandler("POST /api/account/login", async (request, env) => {
  const parsed = await parseJsonBody(request, LoginRequestSchema);
  if (!parsed.ok) return parsed.response;
  const account = await authenticateAccountPassword(env, parsed.data.accountId, parsed.data.password, parsed.data.turnstileToken);
  if (!account.encrypted_secret) return grantAccountSession(env, account.id, account.session_version, true);
  const cookie = await createAuthChallenge(env, request, OTP_LOGIN_COOKIE, {
    account_id: account.id, session_version: account.session_version, purpose: "otp-login",
    action: null, target_id: null, challenge: null, payload: null,
  });
  return authJson({ success: true, next: "otp" }, 200, [cookie]);
});
