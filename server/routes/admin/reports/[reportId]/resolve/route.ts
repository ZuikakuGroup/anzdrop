import { withAdminHandler } from "@/lib/api/adminAuth";
import { resolveRecord } from "@/lib/admin/resolveRecord";
import type { RouteContext } from "@/lib/api/types";

export const POST = withAdminHandler(
  "POST /api/admin/reports/[reportId]/resolve",
  async (_request: Request, env: CloudflareEnv, context: RouteContext<{ reportId: string }>) => {
    const { reportId } = await context.params;
    return resolveRecord(env.DB, "reports", reportId);
  }
);
