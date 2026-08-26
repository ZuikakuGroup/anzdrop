import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt, verifySameOrigin } from "@/lib/access";

type RouteContext = {
  params: Promise<{
    shareId: string;
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

    if (!verifySameOrigin(request)) {
      return Response.json(
        { success: false, error: "Invalid origin" },
        { status: 403 }
      );
    }

    const { shareId } = await context.params;

    await env.DB.prepare(
      `UPDATE shares SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL`
    )
      .bind(new Date().toISOString(), shareId)
      .run();

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/admin/shares/[shareId]/suspend failed:", error);

    return Response.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
