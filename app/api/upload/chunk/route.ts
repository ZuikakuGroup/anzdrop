import { getCloudflareContext } from "@opennextjs/cloudflare";
import { timingSafeEqual } from "@/lib/timingSafeEqual";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import { withApiHandler } from "@/lib/api/handler";
import type { ChunkUploadResponse } from "@/app/api/upload/chunk/schema";

// R2のマルチパートアップロードは、最終パートを除きパートサイズが最小5MiB
// 以上でなければならない制約がある。クライアントは暗号化ストリームを
// UPLOAD_PART_SIZE(8MiB)ちょうどで切り出して送る(最終パートのみ小さい)。
// declaredFileSizeから許容するパート数の上限を、より小さいこの最小粒度で
// 見積もることで、正当なアップロードを弾かずに上限を保守的に定める。
const R2_MULTIPART_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

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

    const upload = await env.DB.prepare(`
    SELECT
        uploads.storage_key AS storage_key,
        uploads.upload_id AS upload_id,
        uploads.file_size AS file_size,
        shares.upload_token AS upload_token
    FROM uploads
    JOIN shares ON shares.id = uploads.share_id
    WHERE uploads.id = ?
    LIMIT 1
    `)
      .bind(uploadSessionId)
      .first<{
        storage_key: string;
        upload_id: string;
        file_size: number | null;
        upload_token: string | null;
      }>();

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

    const tokenMatches =
      !!upload.upload_token &&
      timingSafeEqual(
        new TextEncoder().encode(upload.upload_token),
        new TextEncoder().encode(uploadToken)
      );

    if (!tokenMatches) {
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
    // 濫用を、各リクエスト単位でも防ぐ。実パート数は
    // ceil(暗号文サイズ / UPLOAD_PART_SIZE(8MiB)) だが、暗号文はsalt・IV・
    // GCMタグの分だけ平文より大きいため、より小さい5MiB粒度で見積もって
    // 正当なアップロードを弾かないようにする。
    const declaredFileSize = upload.file_size ?? 0;
    const maxPartNumber = Math.max(
      1,
      Math.ceil(declaredFileSize / R2_MULTIPART_MIN_PART_SIZE_BYTES)
    );

    if (partNumber > maxPartNumber) {
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