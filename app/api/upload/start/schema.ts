import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { isRetention, type Retention } from "@/lib/retention";

export const UploadStartRequestSchema = z.object({
  encryptedFileName: z
    .string({ error: "暗号化済みファイル名が入力されていません" })
    .min(1, { error: "暗号化済みファイル名が入力されていません" }),
  retention: z
    .string({ error: "保存期間の指定が正しくありません" })
    .refine((value): value is Retention => isRetention(value), {
      error: "保存期間の指定が正しくありません",
    }),
  fileSize: z
    .number({ error: "ファイルサイズが入力されていません" })
    .positive({ error: "ファイルサイズが入力されていません" }),
  shareId: z.string().optional(),
  uploadToken: z.string().optional(),
  wrappedKey: z.string().optional(),
  keySalt: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export type UploadStartRequest = z.infer<typeof UploadStartRequestSchema>;

export type UploadStartResponse = ApiResponse<{
  shareId: string;
  uploadToken: string;
  uploadSessionId: string;
  expiresAt: string;
}>;
