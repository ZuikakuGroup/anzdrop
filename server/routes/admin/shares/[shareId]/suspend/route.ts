import { withAdminHandler } from "@/lib/api/adminAuth";
import type { RouteContext } from "@/lib/api/types";

export const POST = withAdminHandler(
  "POST /api/admin/shares/[shareId]/suspend",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ shareId: string }>
  ): Promise<Response> => {
    const { shareId } = await context.params;

    await env.DB.prepare(
      `UPDATE shares SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL`
    )
      .bind(new Date().toISOString(), shareId)
      .run();

    return Response.json({ success: true });
  }
);
