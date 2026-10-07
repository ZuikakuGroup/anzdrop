import { buildSetCookie } from "@/lib/cookie";
import { parseJsonBody } from "@/lib/api/validate";
import { withAccountAuthHandler, requireAuthOrigin, AccountAuthError } from "@/lib/account/authHttp";
import { CodeSchema } from "@/lib/account/authSchemas";
import { grantAccountSession } from "@/lib/account/grantSession";
import { readAuthChallenge, readSecurityAccount, consumeAuthChallenge, verifyAccountOtp, OTP_LOGIN_COOKIE } from "@/lib/account/securityStore";

export const POST = withAccountAuthHandler("POST /api/account/login/otp", async (request, env) => {
  requireAuthOrigin(request);
  const parsed = await parseJsonBody(request, CodeSchema);
  if (!parsed.ok) return parsed.response;
  const challenge = await readAuthChallenge(env, request, OTP_LOGIN_COOKIE, "otp-login");
  if (!challenge.account_id) throw new AccountAuthError();
  const account = await readSecurityAccount(env, challenge.account_id);
  if (!account || account.session_version !== challenge.session_version) throw new AccountAuthError();
  await verifyAccountOtp(env, account, parsed.data.code);
  await consumeAuthChallenge(env, challenge);
  return grantAccountSession(env, account.id, account.session_version, false, [buildSetCookie(OTP_LOGIN_COOKIE, "", 0)]);
});
