const VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifyResult =
  | { success: true }
  | { success: false; errorCodes: string[] };

type SiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

export async function verifyTurnstileToken(
  token: string | undefined | null,
  secretKey: string,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  let response: Response;

  try {
    response = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      body,
    });
  } catch {
    return { success: false, errorCodes: ["network-error"] };
  }

  if (!response.ok) {
    return { success: false, errorCodes: [`http-${response.status}`] };
  }

  let result: SiteverifyResponse;

  try {
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return { success: false, errorCodes: ["invalid-json-response"] };
  }

  if (result.success === true) {
    return { success: true };
  }

  return { success: false, errorCodes: result["error-codes"] ?? [] };
}
