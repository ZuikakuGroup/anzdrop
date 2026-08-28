import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

type ReportRow = {
  id: string;
  resolved_at: string | null;
};

export const POST = withApiHandler(
  "POST /api/admin/reports/[reportId]/resolve",
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

    const report = await env.DB.prepare(
      `SELECT id, resolved_at FROM reports WHERE id = ?`
    )
      .bind(reportId)
      .first<ReportRow>();

    if (!report) {
      return Response.json(
        { success: false, error: "通報が見つかりません" },
        { status: 404 }
      );
    }

    if (!report.resolved_at) {
      await env.DB.prepare(`UPDATE reports SET resolved_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), reportId)
        .run();
    }

    return Response.json({ success: true });
  }
);
