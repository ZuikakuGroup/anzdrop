import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

export const DELETE = withApiHandler(
  "DELETE /api/admin/contacts/[contactId]",
  async (
    request: Request,
    context: RouteContext<{ contactId: string }>
  ): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const { contactId } = await context.params;

    // 既に削除済みのお問い合わせに対しても冪等に成功として扱う。
    await env.DB.prepare(`DELETE FROM contacts WHERE id = ?`)
      .bind(contactId)
      .run();

    return Response.json({ success: true });
  }
);
