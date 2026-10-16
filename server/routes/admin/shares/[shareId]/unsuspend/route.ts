import { withAdminHandler } from "@/lib/api/adminAuth";
import type { RouteContext } from "@/lib/api/types";

export const POST = withAdminHandler(
  "POST /api/admin/shares/[shareId]/unsuspend",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
    const { shareId } = await context.params;

    await env.DB.prepare(`UPDATE shares SET suspended_at = NULL WHERE id = ?`)
      .bind(shareId)
      .run();

    return Response.json({ success: true });
  }
);
