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
  secretKey: string
): Promise<TurnstileVerifyResult> {
  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  // `remoteip` はsiteverify APIの任意パラメータ(発行時IPとの照合によるリプレイ
  // 対策の補助情報)。ウィジェット自体はブラウザがCloudflareのエッジと直接通信して
  // 完結するため、渡さなくても検証は正常に機能する。訪問者のIPアドレスを
  // このアプリのサーバーから外部に転送したくないため、意図的に送っていない。
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

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
