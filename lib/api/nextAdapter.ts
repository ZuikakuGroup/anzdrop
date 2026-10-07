import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withWorkerRuntime } from "@/server/runtime";

// Only the remaining Next app imports this adapter. Hono has no OpenNext dependency.
export function nextAdapter<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      const { env, ctx } = getCloudflareContext();
      return await withWorkerRuntime({ env, ctx }, () => handler(...args));
    } catch {
      return Response.json({ success: false, error: "サーバー内部でエラーが発生しました" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}
