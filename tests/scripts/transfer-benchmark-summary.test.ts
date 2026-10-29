import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = path.resolve("scripts/summarize-transfer-benchmark.mjs");
const metric = { seconds: 2, peakBackingStorageBytes: 1024 ** 2 };
const row = { environment: "local-workerd-proxy", browser: "synthetic", platform: "test", arch: "test", sizeMiB: 1, trial: 1, success: true, upload: metric, download: metric };
async function summarize(before: unknown[], after: unknown[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anzdrop-benchmark-summary-"));
  try {
    const files = [path.join(dir, "before.jsonl"), path.join(dir, "after.jsonl")];
    await Promise.all([before, after].map((rows, i) => writeFile(files[i], rows.map(r => JSON.stringify(r)).join("\n"))));
    return await execute(process.execPath, [script, ...files]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("transfer benchmark reporting", () => {
  it("counts failed attempts while keeping unmeasured phases absent", async () => {
    const { stdout } = await summarize([row, { ...row, trial: 2, success: false, upload: null, download: null }], [{ ...row, success: false, download: null }]);
    const result = JSON.parse(stdout);
    expect(result.before).toMatchObject({ attempts: 2, failures: 1, uploadSeconds: 2, downloadSeconds: 2 });
    expect(result.after).toMatchObject({ attempts: 1, failures: 1, uploadSeconds: 2, downloadSeconds: null, downloadBackingMiB: null });
    expect(result.changePercent.downloadSeconds).toBeNull();
  });

  it("refuses to mix real environments or browser versions", async () => {
    await expect(summarize([row], [{ ...row, environment: "cloud" }])).rejects.toThrow("Only local-workerd-proxy");
    await expect(summarize([row], [{ ...row, browser: "other" }])).rejects.toThrow("must match");
  });

  it("refuses to compare different save routes", async () => {
    await expect(summarize([{ ...row, saveRoute: "service-worker" }], [{ ...row, saveRoute: "blob" }])).rejects.toThrow("Save routes must match");
  });

  it("refuses repeated trials appended under the same label", async () => {
    await expect(summarize([row, row], [row])).rejects.toThrow("Duplicate trials");
  });
});
