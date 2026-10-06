import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { MAX_PART_ACKS_PER_REQUEST } from "@/lib/upload/uploadSessionAuth";

export const UploadPartAckRequestSchema = z.object({
  uploadSessionId: z
    .string({ error: "アップロードセッションIDが入力されていません" })
    .min(1, { error: "アップロードセッションIDが入力されていません" }),
  uploadToken: z
    .string({ error: "アップロードトークンが入力されていません" })
    .min(1, { error: "アップロードトークンが入力されていません" }),
  parts: z
    .array(
      z.object({
        partNumber: z
          .number({ error: "パート番号が正しくありません" })
          .int({ error: "パート番号が正しくありません" })
          .positive({ error: "パート番号が正しくありません" }),
        etag: z
          .string({ error: "ETagが入力されていません" })
          .min(1, { error: "ETagが入力されていません" })
          .max(256, { error: "ETagが長すぎます" }),
      }),
      { error: "パート一覧が正しくありません" }
    )
    .min(1, { error: "パートを1つ以上指定してください" })
    .max(MAX_PART_ACKS_PER_REQUEST, {
      error: `パートは一度に${MAX_PART_ACKS_PER_REQUEST}件までです`,
    }),
});

export type UploadPartAckRequest = z.infer<typeof UploadPartAckRequestSchema>;

export type UploadPartAckResponse = ApiResponse<{
  accepted: number;
}>;
