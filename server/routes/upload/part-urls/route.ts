import { getWorkerRuntime } from "@/server/runtime";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit } from "@/lib/rateLimit";
import { getR2S3Credentials } from "@/lib/upload/r2DirectCredentials";
import { presignUploadPartUrls } from "@/lib/upload/presignUploadPart";
import {
  isPartNumberAllowed,
  loadUploadSession,
  verifyUploadSessionToken,
} from "@/lib/upload/uploadSessionAuth";
import {
  UploadPartUrlsRequestSchema,
  type UploadPartUrlsResponse,
} from "@/app/api/upload/part-urls/schema";

export const POST = withApiHandler(
  "POST /api/upload/part-urls",
  async (request: Request): Promise<Response> => {
    const { env } = getWorkerRuntime();
    const credentials = getR2S3Credentials(env);

    if (!credentials) {
      return Response.json(
        {
          success: false,
          error: "直接アップロードは利用できません",
        },
        { status: 503 }
      );
    }

    const parsed = await parseJsonBody(request, UploadPartUrlsRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { uploadSessionId, uploadToken, parts } = parsed.data;

    const uploadLimit = await checkRateLimit(
      env.UPLOAD_RATE_LIMITER,
      uploadSessionId,
      "POST /api/upload/part-urls"
    );

    if (!uploadLimit.ok) {
      return uploadLimit.response;
    }

    const upload = await loadUploadSession(env.DB, uploadSessionId);

    if (!upload) {
      return Response.json(
        {
          success: false,
          error: "アップロードセッションが見つかりません",
        },
        { status: 404 }
      );
    }

    if (!verifyUploadSessionToken(upload.upload_token, uploadToken)) {
      return Response.json(
        {
          success: false,
          error: "アップロードトークンが正しくありません",
        },
        { status: 403 }
      );
    }

    const declaredFileSize = upload.file_size ?? 0;
    // 同じパート番号が複数来た場合は最後の contentLength を採用。
    const uniqueParts = [
      ...new Map(
        parts.map((part) => [part.partNumber, part] as const)
      ).values(),
    ];

    for (const part of uniqueParts) {
      if (!isPartNumberAllowed(part.partNumber, declaredFileSize)) {
        return Response.json(
          {
            success: false,
            error: "パート番号が想定するチャンク数を超えています",
          },
          { status: 400 }
        );
      }
    }

    const urls = await presignUploadPartUrls({
      credentials,
      storageKey: upload.storage_key,
      uploadId: upload.upload_id,
      parts: uniqueParts,
    });

    const response: UploadPartUrlsResponse = {
      success: true,
      urls,
    };

    return Response.json(response);
  }
);
