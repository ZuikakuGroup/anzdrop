import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PACKED_CHUNK_SIZE } from "@/lib/crypto/types";
import { timingSafeEqual } from "@/lib/timingSafeEqual";

// R2のマルチパートアップロードは、最終パートを除きパートサイズが最小5MiB
// 以上でなければならない制約がある。クライアントは通常CHUNK_SIZE(8MiB)を
// 1パートとして送るが、この制約を満たすためにより細かく分割する余地も
// 考慮し、declaredFileSizeから許容するパート数の上限をこの最小粒度で見積もる。
const R2_MULTIPART_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

type ChunkUploadResponse =
  | {
    success: true;
    partNumber: number;
  }
  | {
    success: false;
    error: string;
  };

export async function POST(
  request: Request
): Promise<Response> {
  try {
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
          error: "Missing headers",
        },
        { status: 400 }
      );
    }

    const partNumber = Number(partNumberHeader);

    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return Response.json(
        {
          success: false,
          error: "Invalid part number",
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
          error: "Empty body",
        },
        {
          status: 400,
        }
      );
    }

    // クライアントは平文をCHUNK_SIZE(8MiB)ごとに区切ってから暗号化・アップロード
    // するため、パート1件あたりの上限はPACKED_CHUNK_SIZE(IV・GCMタグ込み)を
    // 超えない。これを超える場合は不正なリクエストとして拒否する。
    if (body.byteLength > PACKED_CHUNK_SIZE) {
      return Response.json(
        {
          success: false,
          error: "Chunk exceeds maximum allowed size",
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
          error: "Upload session not found",
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
          error: "Invalid uploadToken",
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
    const maxPartNumber = Math.max(
      1,
      Math.ceil(declaredFileSize / R2_MULTIPART_MIN_PART_SIZE_BYTES)
    );

    if (partNumber > maxPartNumber) {
      return Response.json(
        {
          success: false,
          error: "Part number exceeds expected chunk count",
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

  } catch (error) {
    console.error("POST /api/upload/chunk failed:", error);

    const response: ChunkUploadResponse = {
      success: false,
      error: "Internal server error",
    };

    return Response.json(response, {
      status: 500,
    });

  }
}