import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const UploadCompleteRequestSchema = z.object({
  uploadSessionId: z
    .string({ error: "アップロードセッションIDが入力されていません" })
    .min(1, { error: "アップロードセッションIDが入力されていません" }),
});

export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export type UploadCompleteResponse = ApiResponse<{ fileId: string }>;
