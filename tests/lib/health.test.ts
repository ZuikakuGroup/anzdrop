import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDependencies, HEALTH_TIMEOUT_MS } from "@/lib/health";

function bindings(first = vi.fn().mockResolvedValue({ ok: 1 }), head = vi.fn().mockResolvedValue(null)) {
  const prepare = vi.fn().mockReturnValue({ first });
  return { env: { DB: { prepare }, FILES_BUCKET: { head } } as unknown as Pick<CloudflareEnv, "DB" | "FILES_BUCKET">, prepare, head };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("read-only readiness", () => {
  it("accepts missing reserved R2 object and reads no user records", async () => {
    const { env, prepare, head } = bindings();
    expect(await checkDependencies(env)).toEqual({ success: true, checks: { d1: "ok", r2: "ok" } });
    expect(prepare).toHaveBeenCalledExactlyOnceWith("SELECT 1 AS ok");
    expect(head).toHaveBeenCalledExactlyOnceWith("__anzdrop_readiness_probe__");
  });
  it.each(["d1", "r2"])("reports %s failure without exposing provider errors", async kind => {
    const failed = vi.fn().mockRejectedValue(new Error("secret bucket file token"));
    const { env } = kind === "d1" ? bindings(failed) : bindings(undefined, failed);
    const result = await checkDependencies(env);
    expect(result.success).toBe(false);
    expect(result.checks[kind as "d1" | "r2"]).toBe("error");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("rejects empty D1 results", async () => {
    expect((await checkDependencies(bindings(vi.fn().mockResolvedValue(null)).env)).checks.d1).toBe("error");
  });
  it("bounds stalled probes and tolerates their later rejection", async () => {
    vi.useFakeTimers();
    let reject!: (value: Error) => void;
    const { env } = bindings(vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })));
    const pending = checkDependencies(env);
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    expect(await pending).toEqual({ success: false, checks: { d1: "timeout", r2: "ok" } });
    reject(new Error("late secret"));
    await Promise.resolve();
  });
});
