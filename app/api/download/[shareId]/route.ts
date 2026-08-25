import { getCloudflareContext } from "@opennextjs/cloudflare";

type Share = {
  id: string;
  created_at: string;
  expires_at: string;
  wrapped_key: string | null;
  key_salt: string | null;
  suspended_at: string | null;
  preview_allowed: number;
};

type FileRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  encrypted_file_name: string;
  size: number;
  max_downloads: number | null;
};

type RouteContext = {
  params: Promise<{
    shareId: string;
  }>;
};

type DownloadResponseFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

type DownloadResponseShare = {
  id: string;
  expires_at: string;
  wrappedKey: string | null;
  keySalt: string | null;
  previewAllowed: boolean;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const { env } = getCloudflareContext();

    const { shareId } = await context.params;
    const share = await env.DB.prepare(
      `
        SELECT id, created_at, expires_at, wrapped_key, key_salt, suspended_at, preview_allowed
        FROM shares
        WHERE id = ?
      `
    )
      .bind(shareId)
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

    const expiresAt = new Date(share.expires_at);

    if (expiresAt <= new Date()) {
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

    const { results: files } = await env.DB.prepare(
      `
        SELECT
          id,
          share_id,
          storage_key,
          encrypted_file_name,
          size,
          max_downloads
        FROM files
        WHERE share_id = ?
          AND (max_downloads IS NULL OR download_count < max_downloads)
      `
    )
      .bind(shareId)
      .all<FileRecord>();

    const responseShare: DownloadResponseShare = {
      id: share.id,
      expires_at: share.expires_at,
      wrappedKey: share.wrapped_key,
      keySalt: share.key_salt,
      previewAllowed: share.preview_allowed === 1,
    };

    const responseFiles: DownloadResponseFile[] = files.map((file) => ({
      id: file.id,
      name: file.encrypted_file_name,
      size: file.size,
      isOneTime: file.max_downloads !== null,
    }));

    return Response.json(
      {
        success: true,
        share: responseShare,
        files: responseFiles,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
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