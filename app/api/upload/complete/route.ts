import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { getAccountPlanInfo, getMaxFileSizeBytes } from "@/lib/plan";
import { getPlaintextSizeFromCiphertextSize } from "@/lib/crypto";

type UploadCompleteRequest = {
  uploadSessionId: string;
};

type UploadCompleteResponse =
  | {
      success: true;
      fileId: string;
    }
  | {
      success: false;
      error: string;
    };

type UploadRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  upload_id: string;
  encrypted_file_name: string;
  max_downloads: number | null;
};

type UploadPartRecord = {
  part_number: number;
  etag: string;
};

export async function POST(
  request: Request
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const { uploadSessionId } =
      (await request.json()) as UploadCompleteRequest;

    if (!uploadSessionId) {
      return Response.json(
        {
          success: false,
          error: "Missing uploadSessionId",
        },
        { status: 400 }
      );
    }

    const upload = await env.DB.prepare(`
      SELECT
        id,
        share_id,
        storage_key,
        upload_id,
        encrypted_file_name,
        max_downloads
      FROM uploads
      WHERE id = ?
    `)
      .bind(uploadSessionId)
      .first<UploadRecord>();

    if (!upload) {
      return Response.json(
        {
          success: false,
          error: "Upload session not found",
        },
        { status: 404 }
      );
    }

    const { results: parts } = await env.DB.prepare(`
      SELECT part_number, etag
      FROM upload_parts
      WHERE upload_session_id = ?
      ORDER BY part_number ASC
    `)
      .bind(uploadSessionId)
      .all<UploadPartRecord>();

    if (parts.length === 0) {
      return Response.json(
        {
          success: false,
          error: "No uploaded parts found",
        },
        { status: 400 }
      );
    }

    const multipart = env.FILES_BUCKET.resumeMultipartUpload(
      upload.storage_key,
      upload.upload_id
    );

    const object = await multipart.complete(
      parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      }))
    );

    // クライアント申告のfileSizeは/api/upload/startでの事前チェック用に過ぎず、
    // 実際にアップロードされたバイト数の検証には使えない(申告値を小さく偽って
    // 上限チェックを回避し、実際には無制限にチャンクを送りつけられるため)。
    // 実サイズが確定するここで、R2が報告する実際のオブジェクトサイズ(暗号化後)
    // から平文サイズを逆算し、それを正として上限を再検証する。
    // 未ログインの場合は常にfreeプラン扱い(既存の匿名アップロードの挙動を維持)。
    const session = await verifySession(request, env);
    const { plan } = await getAccountPlanInfo(
      session?.accountId ?? null,
      env
    );

    const size = getPlaintextSizeFromCiphertextSize(object.size);

    if (size > getMaxFileSizeBytes(plan)) {
      await env.FILES_BUCKET.delete(upload.storage_key);

      await env.DB.prepare(`
        DELETE FROM upload_parts WHERE upload_session_id = ?
      `)
        .bind(uploadSessionId)
        .run();

      await env.DB.prepare(`
        DELETE FROM uploads WHERE id = ?
      `)
        .bind(uploadSessionId)
        .run();

      return Response.json(
        {
          success: false,
          error: "File exceeds the maximum allowed size",
        },
        { status: 413 }
      );
    }

    const fileId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO files (
        id,
        share_id,
        storage_key,
        encrypted_file_name,
        size,
        max_downloads,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        fileId,
        upload.share_id,
        upload.storage_key,
        upload.encrypted_file_name,
        size,
        upload.max_downloads,
        createdAt
      )
      .run();

    await env.DB.prepare(`
      DELETE FROM upload_parts WHERE upload_session_id = ?
    `)
      .bind(uploadSessionId)
      .run();

    await env.DB.prepare(`
      DELETE FROM uploads WHERE id = ?
    `)
      .bind(uploadSessionId)
      .run();

    const responseBody: UploadCompleteResponse = {
      success: true,
      fileId,
    };

    return Response.json(responseBody);

  } catch (error) {

    const responseBody: UploadCompleteResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, {
      status: 500,
    });
  }
}
