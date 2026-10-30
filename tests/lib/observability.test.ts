import { afterEach, describe, expect, it, vi } from "vitest";
import { observeApiRequest, recordApiException, recordDownloadFailure } from "@/lib/observability";
import { withApiHandler } from "@/lib/api/handler";

afterEach(() => vi.restoreAllMocks());
describe("API observations", () => {
  it("keeps successful and expected client errors quiet and preserves streams", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const status of [200, 206, 400, 403, 404, 429]) {
      const original = new Response("encrypted-stream", { status });
      const { response, requestId } = await observeApiRequest(() => "GET /api/file/:fileId", async () => original);
      expect(response).toBe(original);
      expect(await response.text()).toBe("encrypted-stream");
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it("logs one sanitized event for caught exceptions without trusting headers or URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiHandler("GET /api/file/:fileId", async (request: Request) => { expect(request).toBeInstanceOf(Request); throw new Error("secret filename token URL"); });
    const request = new Request("https://example.com/api/file/secret?token=secret", { headers: { "X-Request-ID": "secret" } });
    const result = await observeApiRequest(() => "GET /api/file/:fileId", () => handler(request));
    expect(result.response.status).toBe(500);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: "api_request", status: 500, errorKind: "exception", requestId: result.requestId }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
  it("distinguishes returned 5xx from slow successful responses at the boundary", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await observeApiRequest(() => "POST /api/upload/start", async () => new Response(null, { status: 503 }));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ errorKind: "server_response" }));
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(5000);
    await observeApiRequest(() => "GET /api/account/me", async () => new Response());
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ errorKind: "slow_response", durationMs: 5000 }));
  });
  it("correlates post-response download failures without recording file details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let background!: Promise<void>;
    const { requestId } = await observeApiRequest(() => "GET /api/file/:fileId", async () => {
      background = gate.then(() => recordDownloadFailure("download_stream_failed"));
      return new Response("encrypted");
    });
    expect(log).not.toHaveBeenCalled();
    release();
    await background;
    expect(log).toHaveBeenCalledExactlyOnceWith({ event: "download_stream_failed", operation: "GET /api/file/:fileId", requestId, timestamp: expect.any(String) });
  });
  it("isolates overlapping requests", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = observeApiRequest(() => "first", async () => { await gate; return new Response(null, { status: 500 }); });
    const second = await observeApiRequest(() => "second", async () => { recordApiException("second"); return new Response(null, { status: 500 }); });
    release();
    const last = await first;
    expect(last.requestId).not.toBe(second.requestId);
    expect(log.mock.calls.map(call => call[0].errorKind)).toEqual(["exception", "server_response"]);
  });
});
