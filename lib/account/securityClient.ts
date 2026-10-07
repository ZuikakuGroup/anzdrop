import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { ApiResponse } from "@/lib/api/response";

export async function accountAuthRequest<T extends Record<string, unknown>>(path: string, body?: unknown): Promise<{ success: true } & T> {
  const response = await fetch(path, body === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json() as ApiResponse<T>;
  if (!response.ok || !data.success) {
    throw new Error(data.success ? "認証処理に失敗しました。" : data.error);
  }
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
