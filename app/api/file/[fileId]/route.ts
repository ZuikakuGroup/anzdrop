import { getCloudflareContext } from "@opennextjs/cloudflare";

type FileRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  encrypted_file_name: string;
};

type DownloadCountResult = {
  download_count: number;
  max_downloads: number | null;
};

async function deleteOneTimeFile(
  env: CloudflareEnv,
  fileId: string,
  storageKey: string
): Promise<void> {
  await env.FILES_BUCKET.delete(storageKey);
  await env.DB.prepare(`DELETE FROM files WHERE id = ?`)
    .bind(fileId)
    .run();
}

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

type Share = {
  id: string;
  created_at: string;
  expires_at: string;
  suspended_at: string | null;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const { env, ctx } = getCloudflareContext();

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
    SELECT id, created_at, expires_at, suspended_at
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

    if (share.suspended_at) {
      return Response.json(
        {
          success: false,
          error: "Share is suspended",
        },
        { status: 403 }
      );
    }

    // ダウンロード回数の上限チェックと加算を1つのUPDATEで原子的に行う。
    // 条件を満たさない(上限に達している)場合は行が返らない。
    const downloadCount = await env.DB.prepare(
      `
      UPDATE files
      SET download_count = download_count + 1
      WHERE id = ?
        AND (max_downloads IS NULL OR download_count < max_downloads)
      RETURNING download_count, max_downloads
      `
    )
      .bind(fileId)
      .first<DownloadCountResult>();

    if (!downloadCount) {
      return Response.json(
        {
          success: false,
          error: "File not found",
        },
        { status: 404 }
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

    if (
      downloadCount.max_downloads !== null &&
      downloadCount.download_count >= downloadCount.max_downloads
    ) {
      // 許可された最後の1回のダウンロードだったので、レスポンスは遅延させずに
      // 裏でR2オブジェクトとDBレコードを削除する。
      ctx.waitUntil(
        deleteOneTimeFile(env, fileId, file.storage_key)
      );
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.encrypted_file_name}"`,
        "Cache-Control": "no-store",
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