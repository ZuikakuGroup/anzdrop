import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import { MAX_PART_URLS_PER_REQUEST } from "@/lib/upload/uploadSessionAuth";

export const UploadPartUrlsRequestSchema = z.object({
  uploadSessionId: z
    .string({ error: "アップロードセッションIDが入力されていません" })
    .min(1, { error: "アップロードセッションIDが入力されていません" }),
  uploadToken: z
    .string({ error: "アップロードトークンが入力されていません" })
    .min(1, { error: "アップロードトークンが入力されていません" }),
  // contentLength は署名に含め、proxy の UPLOAD_PART_SIZE 上限と揃えて
  // 巨大パートの直PUTを防ぐ。
  parts: z
    .array(
      z.object({
        partNumber: z
          .number({ error: "パート番号が正しくありません" })
          .int({ error: "パート番号が正しくありません" })
          .positive({ error: "パート番号が正しくありません" }),
        contentLength: z
          .number({ error: "パートサイズが正しくありません" })
          .int({ error: "パートサイズが正しくありません" })
          .min(1, { error: "パートサイズが正しくありません" })
          .max(UPLOAD_PART_SIZE, {
            error: "パートサイズが上限を超えています",
          }),
      }),
      { error: "パート一覧が正しくありません" }
    )
    .min(1, { error: "パートを1つ以上指定してください" })
    .max(MAX_PART_URLS_PER_REQUEST, {
      error: `パートは一度に${MAX_PART_URLS_PER_REQUEST}件までです`,
    }),
});

export type UploadPartUrlsRequest = z.infer<typeof UploadPartUrlsRequestSchema>;

export type UploadPartUrlsResponse = ApiResponse<{
  urls: Array<{ partNumber: number; url: string }>;
}>;
