import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const UploadCompleteRequestSchema = z.object({
  uploadSessionId: z
    .string({ error: "アップロードセッションIDが入力されていません" })
    .min(1, { error: "アップロードセッションIDが入力されていません" }),
  // start が発行した uploadToken。shareId は URL に露出する公開識別子のため、
  // 完了処理の認可も share-auth.ts と同じく uploadToken の一致で行う
  // (start(相乗り時)・chunk と揃える)。
  uploadToken: z
    .string({ error: "アップロードトークンが入力されていません" })
    .min(1, { error: "アップロードトークンが入力されていません" }),
});

export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export type UploadCompleteResponse = ApiResponse<{ fileId: string }>;
