import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

export const DELETE = withApiHandler(
  "DELETE /api/admin/reports/[reportId]",
  async (
    request: Request,
    context: RouteContext<{ reportId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const { reportId } = await context.params;

    // 既に削除済みの通報に対しても冪等に成功として扱う。
    await env.DB.prepare(`DELETE FROM reports WHERE id = ?`)
      .bind(reportId)
      .run();

    return Response.json({ success: true });
  }
);
