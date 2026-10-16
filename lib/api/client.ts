// JSON control requests only. File streams and signed webhook bodies never pass here.
export type ApiEnvelope = { success: boolean; error?: string };

export function assertApiSuccess<T extends ApiEnvelope>(response: Response, result: T | null, fallback: string): asserts result is T & { success: true } {
  if (!response.ok || !result?.success) throw new Error(result?.error ?? fallback);
}

export async function requestJson<T extends ApiEnvelope>(path: string, init: RequestInit | undefined, fallback: string): Promise<T & { success: true }> {
  const response = await fetch(path, init);
  const result = await response.json().catch(() => null) as T | null;
  assertApiSuccess(response, result, fallback);
  return result;
}

export function postJson<T extends ApiEnvelope>(path: string, body: unknown, fallback: string, init: Omit<RequestInit, "headers" | "method" | "body"> = {}): Promise<T & { success: true }> {
  return requestJson<T>(path, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, fallback);
}
