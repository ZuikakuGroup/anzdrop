import { getCloudflareContext } from "@opennextjs/cloudflare";

type FileRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  encrypted_file_name: string;
};

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

type Share = {
  id: string;
  created_at: string;
  expires_at: string;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const { env } = getCloudflareContext();

    const { fileId } = await context.params;

    const file = await env.DB.prepare(
      `
      SELECT
        id,
        share_id,
        storage_key,
        encrypted_file_name
      FROM files
      WHERE id = ?
      `
    )
      .bind(fileId)
      .first<FileRecord>();

    if (!file) {
      return Response.json(
        {
          success: false,
          error: "File not found",
        },
        { status: 404 }
      );
    }

    const share = await env.DB.prepare(
      `
    SELECT id, created_at, expires_at
    FROM shares
    WHERE id = ?
  `
    )
      .bind(file.share_id)
      .first<Share>();

    if (!share) {
      return Response.json(
        {
          success: false,
          error: "Share not found",
        },
        { status: 404 }
      );
    }

    if (new Date(share.expires_at) <= new Date()) {
      return Response.json(
        {
          success: false,
          error: "Share has expired",
        },
        { status: 410 }
      );
    }

    const object = await env.FILES_BUCKET.get(file.storage_key);

    if (!object) {
      return Response.json(
        {
          success: false,
          error: "File data not found",
        },
        { status: 404 }
      );
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.encrypted_file_name}"`,
      },
    });

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}