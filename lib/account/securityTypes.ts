import type { ApiResponse } from "@/lib/api/response";

export type SecurityAction = "passkey-add" | "passkey-delete" | "totp-enable" | "totp-disable";
export type SecurityStatus = {
  accountId: string;
  totpEnabled: boolean;
  passkeys: { id: string; name: string; createdAt: string }[];
};
export type SecurityResponse = ApiResponse<SecurityStatus>;

export type Reauthentication =
  | { method: "password"; password: string; code?: string; turnstileToken: string }
  | { method: "passkey"; response: import("@simplewebauthn/browser").AuthenticationResponseJSON };
