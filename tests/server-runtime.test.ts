import { describe, expect, it } from "vitest";
import { getWorkerRuntime, withWorkerRuntime, type WorkerRuntime } from "@/server/runtime";

describe("Worker request isolation", () => {
  it("rejects access outside a request instead of reusing the previous account context", () => {
    expect(() => getWorkerRuntime()).toThrow("context is missing");
  });
  it("keeps concurrent bindings and background work with their own request", async () => {
    const seen: string[] = [];
    const context = (label: string): WorkerRuntime => ({ env: { SITE_URL: label } as CloudflareEnv, ctx: { waitUntil: () => { seen.push(label); } } });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = withWorkerRuntime(context("first"), async () => {
      await gate;
      expect(getWorkerRuntime().env.SITE_URL).toBe("first");
      getWorkerRuntime().ctx.waitUntil(Promise.resolve());
    });
    await withWorkerRuntime(context("second"), async () => {
      await Promise.resolve();
      expect(getWorkerRuntime().env.SITE_URL).toBe("second");
      getWorkerRuntime().ctx.waitUntil(Promise.resolve());
      release();
    });
    await first;
    expect(seen).toEqual(["second", "first"]);
    expect(() => getWorkerRuntime()).toThrow();
  });
});
