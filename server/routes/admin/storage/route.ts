import { withAdminHandler } from "@/lib/api/adminAuth";
import { diagnoseStorage } from "@/lib/storage/diagnostics";

export const GET = withAdminHandler("GET /api/admin/storage", async (request, env) => {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["limit", "afterFileId", "objectCursor", "summary", "scan"]);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) {
    return Response.json({ success: false, error: "診断パラメーターが正しくありません" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const value = params.get("limit");
  const limit = value === null ? 20 : /^\d+$/.test(value) ? Number(value) : NaN;
  const afterFileId = params.get("afterFileId") ?? undefined;
  const objectCursor = params.get("objectCursor") ?? undefined;
  const summary = params.get("summary");
  const scan = params.get("scan") ?? "both";
  if (scan !== "files" && scan !== "objects" && scan !== "both") return Response.json({ success: false, error: "診断対象の指定が正しくありません" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40 || (afterFileId?.length ?? 0) > 128 || (objectCursor?.length ?? 0) > 4096 || (summary !== null && summary !== "0" && summary !== "1")) {
    return Response.json({ success: false, error: "診断範囲の指定が正しくありません" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = await diagnoseStorage(env, { limit, afterFileId, objectCursor, scan, ...(summary !== null ? { summary: summary === "1" } : {}) });
  return Response.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
}, { verifyOrigin: false });
