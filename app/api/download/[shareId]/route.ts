import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkShareAccessible } from "@/lib/share-auth";
import { withApiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rateLimit";
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

    // shareId 単位のレート制限(GitHub issue #81)。狙いは「同じ共有への
    // 繰り返しアクセスで D1 の読み取りコストが暴走しないこと」だけで、
    // shareId の総当たり(列挙)への対策ではない。カウンタはキーごとに独立して
    // いるため、毎回違う shareId を試す相手は毎回新しい枠を得る。列挙の抑止は
    // 外側の WAF ルール(IP 単位)の役目。
    //
    // カウンタは Cloudflare のロケーション単位で、同じ共有を同じ地域から同時に
    // ダウンロードする利用者全員が1つの枠を共有する。1つの共有 URL を多人数へ
    // 配る使い方を壊さないよう、また共有 URL を知る第三者が低速な連打で他の
    // 利用者を締め出せないよう、閾値は十分に緩く取ってある
    // (wrangler.jsonc の SHARE_RATE_LIMITER)。
    const shareLimit = await checkRateLimit(
      env.SHARE_RATE_LIMITER,
      shareId,
      "GET /api/download/[shareId]"
    );

    if (!shareLimit.ok) {
      return shareLimit.response;
    }

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
