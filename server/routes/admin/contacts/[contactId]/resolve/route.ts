import { withAdminHandler } from "@/lib/api/adminAuth";
import { resolveRecord } from "@/lib/admin/resolveRecord";
import type { RouteContext } from "@/lib/api/types";

export const POST = withAdminHandler(
  "POST /api/admin/contacts/[contactId]/resolve",
  async (_request: Request, env: CloudflareEnv, context: RouteContext<{ contactId: string }>) => {
    const { contactId } = await context.params;
    return resolveRecord(env.DB, "contacts", contactId);
  }
);
