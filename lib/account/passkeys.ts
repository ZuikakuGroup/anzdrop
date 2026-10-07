import { z } from "zod";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64";
import { AccountAuthError, webauthnSite } from "./authHttp";
import { listPasskeys, readSecurityAccount, type AuthChallenge, type PasskeyRow } from "./securityStore";

const base64 = z.string().min(1).max(32_000).regex(/^[A-Za-z0-9_-]+$/);
const common = {
  id: base64.max(2048), rawId: base64.max(2048), type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.object({ credProps: z.object({ rk: z.boolean().optional() }).optional() }).passthrough(),
};
export const AuthenticationSchema = z.object({ ...common, response: z.object({
  clientDataJSON: base64, authenticatorData: base64, signature: base64,
  userHandle: base64.max(256).optional(),
}) });
export const RegistrationSchema = z.object({ ...common, response: z.object({
  clientDataJSON: base64, attestationObject: base64,
  transports: z.array(z.string().max(32)).max(10).optional(),
}) });

export async function authenticationOptions(keys?: PasskeyRow[]) {
  return generateAuthenticationOptions({ rpID: webauthnSite().rpID, userVerification: "required", timeout: 60_000,
    allowCredentials: keys?.map((key) => ({ id: key.id, transports: JSON.parse(key.transports) as string[] })),
  });
}

export async function registrationOptions(env: CloudflareEnv, accountId: string) {
  const keys = await listPasskeys(env, accountId);
  if (keys.length >= 10) throw new AccountAuthError("登録できるパスキーは10件までです。", 409);
  const userId = keys[0]?.webauthn_user_id ?? encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const options = await generateRegistrationOptions({ rpID: webauthnSite().rpID, rpName: "Anzdrop", userName: accountId,
    userID: new Uint8Array(decodeBase64Url(userId)), attestationType: "none", supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: "required", userVerification: "required" }, extensions: { credProps: true },
    excludeCredentials: keys.map((key) => ({ id: key.id, transports: JSON.parse(key.transports) as string[] })),
  });
  return { options, userId };
}

export async function verifyPasskey(env: CloudflareEnv, challenge: AuthChallenge, response: AuthenticationResponseJSON) {
  if (response.id !== response.rawId || !challenge.challenge) throw new AccountAuthError();
  const key = await env.DB.prepare("SELECT * FROM account_passkeys WHERE id = ?").bind(response.id).first<PasskeyRow>();
  if (!key || (challenge.account_id !== null && challenge.account_id !== key.account_id)) throw new AccountAuthError();
  // Discoverable credentialによるログインではuserHandleも必須。
  if ((challenge.purpose === "passkey-login" && !response.response.userHandle)
    || (response.response.userHandle !== undefined && response.response.userHandle !== key.webauthn_user_id)) throw new AccountAuthError();
  const account = await readSecurityAccount(env, key.account_id);
  if (!account || (challenge.session_version !== null && challenge.session_version !== account.session_version)) throw new AccountAuthError();
  const site = webauthnSite();
  let result;
  try {
    result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter,
        transports: JSON.parse(key.transports) as string[] },
    });
  } catch { throw new AccountAuthError(); }
  if (!result.verified || !result.authenticationInfo.userVerified || !Number.isSafeInteger(result.authenticationInfo.newCounter)) throw new AccountAuthError();
  // 削除・復旧・別の認証との競合を、照合したカウンターと世代を使って排除する。
  const updated = await env.DB.prepare(`UPDATE account_passkeys SET counter = ?, backed_up = ? WHERE id = ? AND account_id = ? AND counter = ?
    AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND session_version = ?)`)
    .bind(result.authenticationInfo.newCounter, Number(result.authenticationInfo.credentialBackedUp), key.id, account.id, key.counter, account.id, account.session_version).run();
  if (updated.meta.changes !== 1) throw new AccountAuthError();
  return account;
}

export async function verifyNewPasskey(challenge: AuthChallenge, response: RegistrationResponseJSON) {
  if (!challenge.challenge || response.id !== response.rawId || response.clientExtensionResults.credProps?.rk === false) throw new AccountAuthError();
  const site = webauthnSite();
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257],
    });
  } catch { throw new AccountAuthError(); }
  if (!result.verified || !result.registrationInfo?.userVerified || result.registrationInfo.fmt !== "none"
    || !Number.isSafeInteger(result.registrationInfo.credential.counter)) throw new AccountAuthError();
  return result.registrationInfo;
}
