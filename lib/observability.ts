import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage<{ exception: boolean; requestId: string }>();
export const SLOW_API_MS = 5_000;

// Only fixed code labels are accepted here. Never pass errors or request data.
export function recordApiException(operation: string): void {
  const context = requests.getStore();
  if (context) context.exception = true;
  else console.error({ event: "api_exception", operation, timestamp: new Date().toISOString() });
}

export async function observeApiRequest(
  operation: () => string,
  run: () => Promise<Response>,
): Promise<{ response: Response; requestId: string }> {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  const context = { exception: false, requestId };
  return requests.run(context, async () => {
    const response = await run();
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    if (response.status >= 500 || durationMs >= SLOW_API_MS) {
      const log = response.status >= 500 ? console.error : console.warn;
      log({
        event: "api_request",
        timestamp: new Date().toISOString(),
        operation: operation(),
        status: response.status,
        durationMs,
        requestId,
        errorKind: context.exception ? "exception" : response.status >= 500 ? "server_response" : "slow_response",
      });
    }
    return { response, requestId };
  });
}

export function recordDownloadFailure(event: "download_stream_failed" | "download_count_restore_failed"): void {
  console.error({ event, operation: "GET /api/file/:fileId", timestamp: new Date().toISOString(), requestId: requests.getStore()?.requestId });
}
