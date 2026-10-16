import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function run(args: string[], fail = "") {
  directory = await mkdtemp(path.join(os.tmpdir(), "anzdrop-check-"));
  const log = path.join(directory, "calls");
  const executable = `#!/usr/bin/env node\nconst fs = require('node:fs'); const args = process.argv.slice(2).join(' '); fs.appendFileSync(process.env.CHECK_LOG, args + '\\n'); if (args === process.env.FAIL_CHECK) process.exit(17);`;
  await Promise.all(["npm", "npx"].map(name => writeFile(path.join(directory!, name), executable, { mode: 0o755 })));
  const result = spawnSync(process.execPath, [path.resolve("scripts/check.mjs"), ...args], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, CHECK_LOG: log, FAIL_CHECK: fail },
  });
  let calls: string[] = [];
  try { calls = (await readFile(log, "utf8")).trim().split("\n"); } catch { /* Invalid selectors must not spawn commands. */ }
  return { ...result, calls };
}

describe("shared validation command", () => {
  it("runs only a selected check", async () => {
    const result = await run(["public"]);
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(["run check:public"]);
  });
  it("runs the complete sequence when every check succeeds", async () => {
    const result = await run([]);
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(["run lint", "tsc --noEmit", "run check:router", "run check:public", "test"]);
  });
  it("does not run later checks after a failure", async () => {
    const result = await run([], "tsc --noEmit");
    expect(result.status).toBe(17);
    expect(result.calls).toEqual(["run lint", "tsc --noEmit"]);
  });
  it("rejects unknown checks before spawning any commands", async () => {
    const result = await run(["unknown"]);
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });
});
