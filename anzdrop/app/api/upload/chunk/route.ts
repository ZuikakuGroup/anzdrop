import { getCloudflareContext } from "@opennextjs/cloudflare";

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

    if (!uploadSessionId || !partNumberHeader) {
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

    const upload = await env.DB.prepare(`
    SELECT
        storage_key,
        upload_id
    FROM uploads
    WHERE id = ?
    LIMIT 1
    `)
      .bind(uploadSessionId)
      .first<{
        storage_key: string;
        upload_id: string;
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

    const response: ChunkUploadResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(response, {
      status: 500,
    });

  }
}