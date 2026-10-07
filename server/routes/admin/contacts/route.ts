import { getWorkerRuntime } from "@/server/runtime";
import {
  parseAdminStatusFilter,
  resolvedAtWhereClause,
} from "@/lib/admin/statusFilter";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";

type ContactRow = {
  id: string;
  name: string | null;
  email: string;
  subject: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
};

type AdminContact = {
  id: string;
  name: string | null;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
};

export const GET = withApiHandler(
  "GET /api/admin/contacts",
  async (request: Request): Promise<Response> => {
    const { env } = getWorkerRuntime();

    const auth = await requireAdmin(request, env, { verifyOrigin: false });

    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const status = parseAdminStatusFilter(url.searchParams.get("status"));

    const { results: contacts } = await env.DB.prepare(
      `
        SELECT id, name, email, subject, message, created_at, resolved_at
        FROM contacts
        ${resolvedAtWhereClause(status)}
        ORDER BY created_at DESC
      `
    ).all<ContactRow>();

    const responseContacts: AdminContact[] = (contacts ?? []).map(
      (contact) => ({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        subject: contact.subject,
        message: contact.message,
        createdAt: contact.created_at,
        resolvedAt: contact.resolved_at,
      })
    );

    return Response.json(
      { success: true, contacts: responseContacts },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
);
