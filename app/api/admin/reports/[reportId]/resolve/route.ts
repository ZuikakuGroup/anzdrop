import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt } from "@/lib/access";

type ReportRow = {
  id: string;
  resolved_at: string | null;
};

type RouteContext = {
  params: Promise<{
    reportId: string;
  }>;
};

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const identity = await verifyAccessJwt(request, env);

    if (!identity) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const { reportId } = await context.params;

    const report = await env.DB.prepare(
      `SELECT id, resolved_at FROM reports WHERE id = ?`
    )
      .bind(reportId)
      .first<ReportRow>();

    if (!report) {
      return Response.json(
        { success: false, error: "Report not found" },
        { status: 404 }
      );
    }

    if (!report.resolved_at) {
      await env.DB.prepare(`UPDATE reports SET resolved_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), reportId)
        .run();
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
