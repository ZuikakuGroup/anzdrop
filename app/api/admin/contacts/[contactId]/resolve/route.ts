import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

type ContactRow = {
  id: string;
  resolved_at: string | null;
};

export const POST = withApiHandler(
  "POST /api/admin/contacts/[contactId]/resolve",
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

    const contact = await env.DB.prepare(
      `SELECT id, resolved_at FROM contacts WHERE id = ?`
    )
      .bind(contactId)
      .first<ContactRow>();

    if (!contact) {
      return Response.json(
        { success: false, error: "お問い合わせが見つかりません" },
        { status: 404 }
      );
    }

    if (!contact.resolved_at) {
      await env.DB.prepare(`UPDATE contacts SET resolved_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), contactId)
        .run();
    }

    return Response.json({ success: true });
  }
);
