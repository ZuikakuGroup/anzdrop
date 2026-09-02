import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { getAccountPlanInfo, getMaxFileSizeBytes } from "@/lib/plan";
import { getPlaintextSizeFromCiphertextSize } from "@/lib/crypto";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import { checkShareAccessible } from "@/lib/share-auth";
import { timingSafeEqual } from "@/lib/timingSafeEqual";
import {
  UploadCompleteRequestSchema,
  type UploadCompleteResponse,
} from "@/app/api/upload/complete/schema";

type UploadRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  upload_id: string;
  encrypted_file_name: string;
  max_downloads: number | null;
  share_upload_token: string | null;
  share_expires_at: string;
  share_suspended_at: string | null;
};

type UploadPartRecord = {
  part_number: number;
  etag: string;
};

export const POST = withApiHandler(
  "POST /api/upload/complete",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, UploadCompleteRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { uploadSessionId, uploadToken } = parsed.data;

    const upload = await env.DB.prepare(`
      SELECT
        uploads.id AS id,
        uploads.share_id AS share_id,
        uploads.storage_key AS storage_key,
        uploads.upload_id AS upload_id,
        uploads.encrypted_file_name AS encrypted_file_name,
        uploads.max_downloads AS max_downloads,
        shares.upload_token AS share_upload_token,
        shares.expires_at AS share_expires_at,
        shares.suspended_at AS share_suspended_at
      FROM uploads
      JOIN shares ON shares.id = uploads.share_id
      WHERE uploads.id = ?
      LIMIT 1
    `)
      .bind(uploadSessionId)
      .first<UploadRecord>();

    if (!upload) {
      return Response.json(
        {
          success: false,
          error: "アップロードセッションが見つかりません",
        },
        { status: 404 }
      );
    }

    // shareId は URL に露出する公開識別子のため、完了処理の認可も start(相乗り
    // 時)・chunk と同じく uploadToken の一致(定数時間比較)で行う。
    const tokenMatches =
      !!upload.share_upload_token &&
      timingSafeEqual(
        new TextEncoder().encode(upload.share_upload_token),
        new TextEncoder().encode(uploadToken)
      );

    if (!tokenMatches) {
      return Response.json(
        {
          success: false,
          error: "アップロードトークンが正しくありません",
        },
        { status: 403 }
      );
    }

    // 期限切れ・管理者による停止済みの共有へは、start より後に停止された
    // セッションであってもファイルを追加させない(download 系と同じ判定)。
    // ここで拒否した場合、R2 の未完了マルチパートと uploads/upload_parts 行は
    // 「パート 0 件」等の他の失敗経路と同じくその場では消さず、cleanupStaleUploads
    // (24 時間)と期限切れ共有 cleanup に後始末を委ねる。
    const access = checkShareAccessible({
      expiresAt: upload.share_expires_at,
      suspendedAt: upload.share_suspended_at,
    });

    if (!access.ok) {
      return Response.json(
        { success: false, error: access.error },
        { status: access.status }
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
          error: "アップロード済みのパートが見つかりません",
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
          error: "ファイルサイズが上限を超えています",
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
  }
);
