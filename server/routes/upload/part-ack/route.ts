import { getWorkerRuntime } from "@/server/runtime";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  isPartNumberAllowed,
  loadUploadSession,
  verifyUploadSessionToken,
} from "@/lib/upload/uploadSessionAuth";
import {
  UploadPartAckRequestSchema,
  type UploadPartAckResponse,
} from "@/app/api/upload/part-ack/schema";

export const POST = withApiHandler(
  "POST /api/upload/part-ack",
  async (request: Request): Promise<Response> => {
    const { env } = getWorkerRuntime();
    const parsed = await parseJsonBody(request, UploadPartAckRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { uploadSessionId, uploadToken, parts } = parsed.data;

    const uploadLimit = await checkRateLimit(
      env.UPLOAD_RATE_LIMITER,
      uploadSessionId,
      "POST /api/upload/part-ack"
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

    for (const part of parts) {
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

    // 同じパート番号が複数来た場合は最後の ETag を採用(再送対応)。
    const latestByPart = new Map<number, string>();
    for (const part of parts) {
      latestByPart.set(part.partNumber, part.etag);
    }

    const statements = [...latestByPart.entries()].map(([partNumber, etag]) =>
      env.DB.prepare(
        `
        INSERT OR REPLACE INTO upload_parts (
          upload_session_id,
          part_number,
          etag
        )
        VALUES (?, ?, ?)
        `
      ).bind(uploadSessionId, partNumber, etag)
    );

    await env.DB.batch(statements);

    const response: UploadPartAckResponse = {
      success: true,
      accepted: latestByPart.size,
    };

    return Response.json(response);
  }
);
