import { withAdminHandler } from "@/lib/api/adminAuth";
import type { RouteContext } from "@/lib/api/types";
import { deleteShare, ShareDeletionDeferredError, StorageReconciliationError } from "@/lib/cleanup";

type ShareRow = {
  expires_at: string;
  suspended_at: string | null;
  file_count: number;
};

export type ShareInfo = {
  exists: boolean;
  expired: boolean;
  suspended: boolean;
  fileCount: number;
};

export const GET = withAdminHandler(
  "GET /api/admin/shares/[shareId]",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
    const { shareId } = await context.params;

    const share = await env.DB.prepare(
      `
        SELECT s.expires_at AS expires_at, s.suspended_at AS suspended_at,
               COUNT(f.id) AS file_count
        FROM shares s
        LEFT JOIN files f ON f.share_id = s.id
        WHERE s.id = ?
        GROUP BY s.id
      `
    )
      .bind(shareId)
      .first<ShareRow>();

    const info: ShareInfo = share
      ? {
          exists: true,
          expired: new Date(share.expires_at) <= new Date(),
          suspended: share.suspended_at !== null,
          fileCount: share.file_count,
        }
      : { exists: false, expired: false, suspended: false, fileCount: 0 };

    return Response.json(
      { success: true, share: info },
      { headers: { "Cache-Control": "no-store" } }
    );
  },
  { verifyOrigin: false }
);

export const DELETE = withAdminHandler(
  "DELETE /api/admin/shares/[shareId]",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
    const { shareId } = await context.params;

    // 既に(期限切れcronや二重クリックで)削除済みの共有に対しても、
    // 冪等に成功として扱う。
    try { await deleteShare(env, shareId); }
    catch (error) {
      if (error instanceof ShareDeletionDeferredError) {
        return Response.json({ success: false, partial: true, retryable: true, error: "削除は一部完了しました。もう一度削除を実行してください。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      if (error instanceof StorageReconciliationError) {
        return Response.json({ success: false, retryable: false, error: "ストレージの整合性確認が必要です。診断結果を確認してください。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }

    return Response.json({ success: true });
  }
);
