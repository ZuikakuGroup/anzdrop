import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt, verifySameOrigin } from "@/lib/access";

type RouteContext = {
  params: Promise<{
    reportId: string;
  }>;
};

export async function DELETE(
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

    if (!verifySameOrigin(request)) {
      return Response.json(
        { success: false, error: "Invalid origin" },
        { status: 403 }
      );
    }

    const { reportId } = await context.params;

    // 既に削除済みの通報に対しても冪等に成功として扱う。
    await env.DB.prepare(`DELETE FROM reports WHERE id = ?`)
      .bind(reportId)
      .run();

    return Response.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/reports/[reportId] failed:", error);

    return Response.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
