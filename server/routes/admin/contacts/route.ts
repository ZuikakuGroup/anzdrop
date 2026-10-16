import type { AdminContact } from "@/lib/admin/contactsApi";
import {
  parseAdminStatusFilter,
  resolvedAtWhereClause,
} from "@/lib/admin/statusFilter";
import { withAdminHandler } from "@/lib/api/adminAuth";

type ContactRow = {
  id: string;
  name: string | null;
  email: string;
  subject: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
};



export const GET = withAdminHandler(
  "GET /api/admin/contacts",
  async (request: Request, env: CloudflareEnv): Promise<Response> => {
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
  },
  { verifyOrigin: false }
);
