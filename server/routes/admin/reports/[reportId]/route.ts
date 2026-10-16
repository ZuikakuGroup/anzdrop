import { withAdminHandler } from "@/lib/api/adminAuth";
import type { RouteContext } from "@/lib/api/types";

export const DELETE = withAdminHandler(
  "DELETE /api/admin/reports/[reportId]",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ reportId: string }>
  ): Promise<Response> => {
    const { reportId } = await context.params;

    // 既に削除済みの通報に対しても冪等に成功として扱う。
    await env.DB.prepare(`DELETE FROM reports WHERE id = ?`)
      .bind(reportId)
      .run();

    return Response.json({ success: true });
  }
);
