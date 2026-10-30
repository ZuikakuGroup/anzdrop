import { withAdminHandler } from "@/lib/api/adminAuth";
import { checkDependencies } from "@/lib/health";

export const GET = withAdminHandler("GET /api/admin/health", async (_request, env) => {
  const result = await checkDependencies(env);
  if (!result.success) console.error({ event: "dependency_health", operation: "readiness", ...result.checks, timestamp: new Date().toISOString() });
  return Response.json(result, { status: result.success ? 200 : 503 });
}, { verifyOrigin: false });
