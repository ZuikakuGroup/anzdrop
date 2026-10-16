import { requestJson, postJson } from "@/lib/api/client";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { ApiResponse } from "@/lib/api/response";

export async function accountAuthRequest<T extends Record<string, unknown>>(path: string, body?: unknown): Promise<{ success: true } & T> {
  const fallback = "認証処理に失敗しました。";
  const data = body === undefined
    ? await requestJson<ApiResponse<T>>(path, { cache: "no-store" }, fallback)
    : await postJson<ApiResponse<T>>(path, body, fallback, { cache: "no-store" });
  return data;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential !== "undefined";
}

export function isPasskeyCancellation(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && (error.name === "NotAllowedError" || error.name === "AbortError");
}

export async function loginWithPasskey(turnstileToken: string): Promise<void> {
  const { options } = await accountAuthRequest<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/account/passkey/options", { turnstileToken });
  const response = await startAuthentication({ optionsJSON: options });
  await accountAuthRequest("/api/account/passkey/verify", { response });
}
