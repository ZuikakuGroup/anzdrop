import { getCloudflareContext } from "@opennextjs/cloudflare";

type UploadStartRequest = {
  encryptedFileName: string;
  shareId?: string;
  fileSize?: number;
};

type UploadStartResponse =
  | {
      success: true;
      shareId: string;
      uploadSessionId: string;
      expiresAt: string;
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

    // リクエスト取得
    const requestBody =
      (await request.json()) as UploadStartRequest;

    const { encryptedFileName, fileSize } = requestBody;

    if (!encryptedFileName) {
      return Response.json(
        {
          success: false,
          error: "Missing encryptedFileName",
        },
        {
          status: 400,
        }
      );
    }

    const uploadSessionId = crypto.randomUUID();
    const storageKey = crypto.randomUUID();

    const createdAt = new Date().toISOString();

    let shareId = requestBody.shareId;
    let expiresAt: string;

    if (shareId) {
      // 既存の共有に相乗り(複数ファイル対応)
      const existingShare = await env.DB.prepare(`
        SELECT expires_at FROM shares WHERE id = ?
      `)
        .bind(shareId)
        .first<{ expires_at: string }>();

      if (!existingShare) {
        return Response.json(
          {
            success: false,
            error: "Share not found",
          },
          { status: 404 }
        );
      }

      expiresAt = existingShare.expires_at;
    } else {
      shareId = crypto.randomUUID();
      expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      // Share作成
      await env.DB.prepare(`
        INSERT INTO shares (
          id,
          created_at,
          expires_at
        )
        VALUES (?, ?, ?)
      `)
        .bind(
          shareId,
          createdAt,
          expiresAt
        )
        .run();
    }

    // Multipart Upload開始
    const multipart =
      await env.FILES_BUCKET.createMultipartUpload(
        storageKey
      );

    // Upload Session保存
    await env.DB.prepare(`
      INSERT INTO uploads (
        id,
        share_id,
        storage_key,
        upload_id,
        encrypted_file_name,
        file_size,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        uploadSessionId,
        shareId,
        storageKey,
        multipart.uploadId,
        encryptedFileName,
        fileSize ?? null,
        createdAt
      )
      .run();

    const responseBody: UploadStartResponse = {
      success: true,
      shareId,
      uploadSessionId,
      expiresAt,
    };

    return Response.json(responseBody);

  } catch (error) {

    const responseBody: UploadStartResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, {
      status: 500,
    });
  }
}