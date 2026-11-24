import { describe, expect, it, vi } from "vitest";
import { monitor } from "../../scripts/monitor-production.mjs";

const env = { MONITOR_BASE_URL: "https://monitor.example", MONITOR_ACCESS_JWT: "secret-jwt", MONITOR_WEBHOOK_URL: "https://hooks.example/secret-token" };
const health = { success: true, checks: { d1: "ok", r2: "ok" } };
const data = { uploadSuccessRate: 1, downloadSuccessRate: null, uploadErrorsByCode: [], downloadErrorsByCode: [] };
function page() { return new Response("<html><head><title>Anzdrop</title></head></html>", { headers: { "Content-Type": "text/html" } }); }
function fetcher(report = data, readiness = health) {
  return vi.fn().mockResolvedValueOnce(Response.json(readiness)).mockResolvedValueOnce(page()).mockResolvedValueOnce(Response.json({ success: true, data: report })).mockResolvedValue(new Response());
}
describe("production monitor (network mocked)", () => {
  it("does not notify even when a webhook is configured", async () => {
    const mock = fetcher();
    expect(await monitor(env, { fetcher: mock })).toEqual({ success: true, alerts: [] });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Cookie: "CF_Authorization=secret-jwt" } });
  });
  it("detects failed readiness, ignores HTTP 200 without dependency results", async () => {
    const mock = fetcher(data, { success: true } as typeof health);
    expect((await monitor(env, { fetcher: mock })).alerts).toEqual(["readiness_failed"]);
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("detects transfer degradation and sends only fixed alert codes with explicit opt-in", async () => {
    const mock = fetcher({ ...data, uploadSuccessRate: 0.89, uploadErrorsByCode: [{ code: "secret-user-input", count: 10 }] } as typeof data);
    expect((await monitor(env, { fetcher: mock, notify: true })).alerts).toEqual(["upload_failure_rate"]);
    const notification = mock.mock.calls[3];
    expect(notification[1].body).toBe('{"text":"Anzdrop: upload_failure_rate"}');
    expect(notification[1].headers).toEqual({ "Content-Type": "application/json" });
  });
  it.each([9, 0])("suppresses low volume transfer warnings (%s errors)", async count => {
    const mock = fetcher({ ...data, uploadSuccessRate: 0.1, uploadErrorsByCode: [{ code: "network", count }] } as typeof data);
    expect((await monitor(env, { fetcher: mock })).success).toBe(true);
  });
  it("keeps the 90% boundary quiet and detects download degradation", async () => {
    const mock = fetcher({ ...data, uploadSuccessRate: 0.9, uploadErrorsByCode: [{ code: "network", count: 10 }], downloadSuccessRate: 0.5, downloadErrorsByCode: [{ code: "network", count: 12 }] } as unknown as typeof data);
    expect((await monitor(env, { fetcher: mock })).alerts).toEqual(["download_failure_rate"]);
  });
  it("detects a public request timeout even when API dependencies succeed", async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json(health)).mockRejectedValueOnce(new DOMException("secret-url", "TimeoutError")).mockResolvedValueOnce(Response.json({ success: true, data }));
    expect((await monitor(env, { fetcher: mock })).alerts).toEqual(["public_unavailable"]);
  });
  it("treats redirect rejection as a failure without forwarding credentials", async () => {
    const mock = vi.fn().mockRejectedValueOnce(new TypeError("redirect")).mockResolvedValueOnce(page()).mockResolvedValueOnce(Response.json({ success: true, data }));
    expect((await monitor(env, { fetcher: mock })).alerts).toEqual(["readiness_failed"]);
    expect(mock.mock.calls[0][1].redirect).toBe("error");
    expect(mock.mock.calls[1][1].headers).toBeUndefined();
  });
  it("handles network failures without returning secrets", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("secret-key URL filename"));
    const result = await monitor(env, { fetcher: mock });
    expect(result.alerts).toEqual(["readiness_failed", "public_unavailable", "analytics_unavailable"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("surfaces notification delivery failure", async () => {
    const broken = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(page()).mockResolvedValueOnce(Response.json({ success: true, data })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(monitor(env, { fetcher: broken, notify: true })).rejects.toThrow("Notification failed");
  });
  it.each([undefined, "http://hooks.example/secret"])("rejects invalid notification config even when healthy (%s)", async url => {
    const mock = fetcher();
    await expect(monitor({ ...env, MONITOR_WEBHOOK_URL: url }, { fetcher: mock, notify: true })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([new Response(null, { status: 503 }), new Response("<title>Error</title>", { headers: { "Content-Type": "text/html" } })])("detects PUBLIC failure while APP is healthy", async response => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json(health)).mockResolvedValueOnce(response).mockResolvedValueOnce(Response.json({ success: true, data }));
    expect((await monitor(env, { fetcher: mock })).alerts).toEqual(["public_unavailable"]);
    expect(mock.mock.calls[1][1].headers).toBeUndefined();
  });
  it("rejects origins containing credentials or paths before making requests", async () => {
    const mock = vi.fn();
    await expect(monitor({ ...env, MONITOR_BASE_URL: "https://secret@example.com/path" }, { fetcher: mock })).rejects.toThrow("Invalid monitor origin");
    expect(mock).not.toHaveBeenCalled();
  });
});
