import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";
import { deleteShare } from "@/lib/cleanup";

export const DELETE = withApiHandler(
  "DELETE /api/admin/shares/[shareId]",
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

    // 既に(期限切れcronや二重クリックで)削除済みの共有に対しても、
    // 冪等に成功として扱う。
    await deleteShare(env, shareId);

    return Response.json({ success: true });
  }
);
