import { withAdminHandler } from "@/lib/api/adminAuth";
import type { RouteContext } from "@/lib/api/types";

export const DELETE = withAdminHandler(
  "DELETE /api/admin/contacts/[contactId]",
  async (
    _request: Request,
    env: CloudflareEnv,
    context: RouteContext<{ contactId: string }>
  ): Promise<Response> => {
    const { contactId } = await context.params;

    // 既に削除済みのお問い合わせに対しても冪等に成功として扱う。
    await env.DB.prepare(`DELETE FROM contacts WHERE id = ?`)
      .bind(contactId)
      .run();

    return Response.json({ success: true });
  }
);
