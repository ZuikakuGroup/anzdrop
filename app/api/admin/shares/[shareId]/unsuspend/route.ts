import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

export const POST = withApiHandler(
  "POST /api/admin/shares/[shareId]/unsuspend",
  async (
    request: Request,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const { shareId } = await context.params;

    await env.DB.prepare(`UPDATE shares SET suspended_at = NULL WHERE id = ?`)
      .bind(shareId)
      .run();

    return Response.json({ success: true });
  }
);
