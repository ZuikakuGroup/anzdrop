import { getCloudflareContext } from "@opennextjs/cloudflare";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import {
  isPartNumberAllowed,
  loadUploadSession,
  verifyUploadSessionToken,
} from "@/lib/upload/uploadSessionAuth";
import { withApiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rateLimit";
import type { ChunkUploadResponse } from "@/app/api/upload/chunk/schema";

export const POST = withApiHandler(
  "POST /api/upload/chunk",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    // Header取得
    const uploadSessionId =
      request.headers.get("Anzdrop-Upload-Session");

    const partNumberHeader =
      request.headers.get("Anzdrop-Part-Number");

    const uploadToken = request.headers.get("Anzdrop-Upload-Token");

    if (!uploadSessionId || !partNumberHeader || !uploadToken) {
      return Response.json(
        {
          success: false,
          error: "必要なヘッダーがありません",
        },
        { status: 400 }
      );
    }

    const partNumber = Number(partNumberHeader);

    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return Response.json(
        {
          success: false,
          error: "パート番号が正しくありません",
        },
        { status: 400 }
      );
    }

    // アップロードセッション単位のレート制限(GitHub issue #81)。8MiB の
    // ボディを読み込む前に弾くことで、超過したリクエストの転送コスト自体を
    // 発生させない。アップロードトークンの検証より前になるが、キーにする
    // uploadSessionId は本人しか知らない値なので、他人の枠を狙って消費するには
    // まずセッション ID を知る必要がある(知っていればトークンが要る)。
    //
    // クライアントは最大12並列(lib/plan.ts の uploadConcurrency)で 8MiB の
    // パートを送るため、閾値は正当な高速回線でも届かない水準にしてある
    // (wrangler.jsonc の UPLOAD_RATE_LIMITER)。
    const uploadLimit = await checkRateLimit(
      env.UPLOAD_RATE_LIMITER,
      uploadSessionId,
      "POST /api/upload/chunk"
    );

    if (!uploadLimit.ok) {
      return uploadLimit.response;
    }

    // バイナリ取得
    const body = await request.arrayBuffer();

    if (body.byteLength === 0) {
      return Response.json(
        {
          success: false,
          error: "リクエストボディが空です",
        },
        {
          status: 400,
        }
      );
    }

    // クライアントは暗号化ストリームをUPLOAD_PART_SIZEちょうどで切り出して送り、
    // 最終パートだけがそれ未満になる。よってどのパートもUPLOAD_PART_SIZEを
    // 超えることはない。これを超える場合は不正なリクエストとして拒否する。
    if (body.byteLength > UPLOAD_PART_SIZE) {
      return Response.json(
        {
          success: false,
          error: "チャンクサイズが上限を超えています",
        },
        {
          status: 413,
        }
      );
    }

    const upload = await loadUploadSession(env.DB, uploadSessionId);

    if (!upload) {
      return Response.json(
        {
          success: false,
          error: "アップロードセッションが見つかりません",
        },
        {
          status: 404,
        }
      );
    }

    if (!verifyUploadSessionToken(upload.upload_token, uploadToken)) {
      return Response.json(
        {
          success: false,
          error: "アップロードトークンが正しくありません",
        },
        {
          status: 403,
        }
      );
    }

    // /api/upload/startで検証済みの申告fileSizeから、このアップロードで
    // 有効なパート番号の上限を導く。これにより、completeを呼ばずにチャンクを
    // 送り続けてストレージを無制限に消費する(cleanupの猶予時間まで居座る)
    // 濫用を、各リクエスト単位でも防ぐ。
    const declaredFileSize = upload.file_size ?? 0;

    if (!isPartNumberAllowed(partNumber, declaredFileSize)) {
      return Response.json(
        {
          success: false,
          error: "パート番号が想定するチャンク数を超えています",
        },
        {
          status: 400,
        }
      );
    }

    const multipart =
      env.FILES_BUCKET.resumeMultipartUpload(
        upload.storage_key,
        upload.upload_id
      );

    const uploadedPart =
      await multipart.uploadPart(
        partNumber,
        body
      );

    await env.DB.prepare(`
    INSERT OR REPLACE INTO upload_parts (
      upload_session_id,
      part_number,
      etag
    )
    VALUES (?, ?, ?)
    `)
      .bind(
        uploadSessionId,
        partNumber,
        uploadedPart.etag
      )
      .run();

    const response: ChunkUploadResponse = {
      success: true,
      partNumber,
    };

    return Response.json(response);
  }
);
