import { z } from "zod";

export const CodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "6桁の認証コードを入力してください") });
export const ActionSchema = z.object({
  action: z.enum(["passkey-add", "passkey-delete", "totp-enable", "totp-disable"]),
  targetId: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).refine((value) => value.action !== "passkey-delete" || !!value.targetId, "削除するパスキーが指定されていません");
export const PasswordReauthSchema = ActionSchema.safeExtend({
  password: z.string().min(1).max(1024), code: z.string().regex(/^\d{6}$/).optional(), turnstileToken: z.string().optional(),
});
