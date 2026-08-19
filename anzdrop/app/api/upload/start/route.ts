import { getCloudflareContext } from "@opennextjs/cloudflare";

type UploadStartRequest = {
  encryptedFileName: string;
};

type UploadStartResponse =
  | {
      success: true;
      shareId: string;
      uploadSessionId: string;
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

    const { encryptedFileName } = requestBody;

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

    const shareId = crypto.randomUUID();
    const uploadSessionId = crypto.randomUUID();
    const storageKey = crypto.randomUUID();

    const createdAt = new Date().toISOString();

    const expiresAt = new Date(
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
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        uploadSessionId,
        shareId,
        storageKey,
        multipart.uploadId,
        encryptedFileName,
        createdAt
      )
      .run();

    const responseBody: UploadStartResponse = {
      success: true,
      shareId,
      uploadSessionId,
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