import { AsyncLocalStorage } from "node:async_hooks";

export type WorkerRuntime = { env: CloudflareEnv; ctx: Pick<ExecutionContext, "waitUntil"> };

// Request-local context: concurrent requests never share bindings or waitUntil.
const runtime = new AsyncLocalStorage<WorkerRuntime>();
export function withWorkerRuntime<T>(context: WorkerRuntime, handler: () => T): T {
  return runtime.run(context, handler);
}
export function getWorkerRuntime(): WorkerRuntime {
  const context = runtime.getStore();
  if (!context) throw new Error("Worker request context is missing");
  return context;
}
