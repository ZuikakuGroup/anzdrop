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

export type TurnstileGuardResult =
  | { ok: true }
  | { ok: false; response: Response };

// app/api/**の5ルート(login/signup/recover/report/upload/start)で手作業
// コピーされていた「verifyTurnstileToken→失敗時に403応答を組み立てる」の
// 定型をまとめる。
export async function requireTurnstile(
  token: string | undefined | null,
  secretKey: string
): Promise<TurnstileGuardResult> {
  const verification = await verifyTurnstileToken(token, secretKey);

  if (!verification.success) {
    return {
      ok: false,
      response: Response.json(
        { success: false, error: "Turnstile verification failed" },
        { status: 403 }
      ),
    };
  }

  return { ok: true };
}
