import { getCloudflareContext } from "@opennextjs/cloudflare";

type UploadStartRequest = {
  encryptedFileName: string;
  shareId?: string;
  uploadToken?: string;
  fileSize?: number;
};

type UploadStartResponse =
  | {
      success: true;
      shareId: string;
      uploadToken: string;
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
    let uploadToken: string;
    let expiresAt: string;

    if (shareId) {
      // 既存の共有に相乗り(複数ファイル対応)。
      // shareIdはURLパスに含まれ第三者に露出しうる公開識別子のため、
      // 所有権の証明にはサーバー生成のuploadToken(URLに含まれず、
      // アップロード完了までクライアントのメモリ上にのみ存在する)の一致を必須とする。
      const providedToken = requestBody.uploadToken;

      if (!providedToken) {
        return Response.json(
          {
            success: false,
            error: "Missing uploadToken",
          },
          { status: 400 }
        );
      }

      const existingShare = await env.DB.prepare(`
        SELECT expires_at, upload_token FROM shares WHERE id = ?
      `)
        .bind(shareId)
        .first<{ expires_at: string; upload_token: string | null }>();

      if (!existingShare) {
        return Response.json(
          {
            success: false,
            error: "Share not found",
          },
          { status: 404 }
        );
      }

      if (
        !existingShare.upload_token ||
        existingShare.upload_token !== providedToken
      ) {
        return Response.json(
          {
            success: false,
            error: "Invalid uploadToken",
          },
          { status: 403 }
        );
      }

      if (new Date(existingShare.expires_at) <= new Date()) {
        return Response.json(
          {
            success: false,
            error: "Share has expired",
          },
          { status: 410 }
        );
      }

      uploadToken = providedToken;
      expiresAt = existingShare.expires_at;
    } else {
      shareId = crypto.randomUUID();
      uploadToken = crypto.randomUUID();
      expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      // Share作成
      await env.DB.prepare(`
        INSERT INTO shares (
          id,
          created_at,
          expires_at,
          upload_token
        )
        VALUES (?, ?, ?, ?)
      `)
        .bind(
          shareId,
          createdAt,
          expiresAt,
          uploadToken
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
      uploadToken,
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