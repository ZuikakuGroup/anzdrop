import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkShareAccessible } from "@/lib/share-auth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";
import type {
  DownloadResponse,
  DownloadResponseFile,
  DownloadResponseShare,
} from "@/app/api/download/[shareId]/schema";

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

export const GET = withApiHandler(
  "GET /api/download/[shareId]",
  async (
    request: Request,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
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
          error: "共有が見つかりません",
        },
        { status: 404 }
      );
    }

    const access = checkShareAccessible({
      expiresAt: share.expires_at,
      suspendedAt: share.suspended_at,
    });

    if (!access.ok) {
      return Response.json(
        { success: false, error: access.error },
        { status: access.status }
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

    const responseBody: DownloadResponse = {
      success: true,
      share: responseShare,
      files: responseFiles,
    };

    return Response.json(responseBody, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
);
