import { withWorkerRuntime, type WorkerRuntime } from "@/server/runtime";

// Run existing handler tests with real request-local bindings, including waitUntil.
export function bindRouteHandlers<T extends Record<string, unknown>>(
  routes: T,
  context: () => { env: CloudflareEnv; ctx?: WorkerRuntime["ctx"] },
): T {
  return Object.fromEntries(Object.entries(routes).map(([name, handler]) => [name,
    typeof handler !== "function" ? handler : async (...args: unknown[]) => {
      const { env, ctx = { waitUntil: () => {} } } = context();
      try {
        return await withWorkerRuntime({ env, ctx }, () => handler(...args));
      } catch {
        return Response.json({ success: false, error: "サーバー内部でエラーが発生しました" }, { status: 500, headers: { "Cache-Control": "no-store" } });
      }
    },
  ])) as T;
}
