import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("deployment archive", () => {
  it("produces identical bytes when only input file timestamps change", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anzdrop-artifact-"));
    tempDirs.push(dir);
    mkdirSync(path.join(dir, "compiled/app"), { recursive: true });
    const file = path.join(dir, "compiled/app/worker.js");
    const readme = path.join(dir, "compiled/app/README.md");
    writeFileSync(file, "export default {};\n");
    writeFileSync(readme, "generated at 2026-09-30T00:00:00Z");
    const first = path.join(tmpdir(), `${path.basename(dir)}-first.tar`);
    const second = path.join(tmpdir(), `${path.basename(dir)}-second.tar`);
    try {
      execFileSync("python3", ["scripts/create-deployment-tar.py", dir, first]);
      utimesSync(file, new Date(0), new Date("2030-01-01T00:00:00Z"));
      writeFileSync(readme, "generated at 2030-01-01T00:00:00Z");
      execFileSync("python3", ["scripts/create-deployment-tar.py", dir, second]);
      expect(digest(first)).toBe(digest(second));
    } finally {
      rmSync(first, { force: true });
      rmSync(second, { force: true });
    }
  });

  it("rejects symlinks that could read files outside the archive", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anzdrop-artifact-"));
    tempDirs.push(dir);
    symlinkSync("/etc/hosts", path.join(dir, "outside"));
    const output = path.join(tmpdir(), `${path.basename(dir)}.tar`);
    try {
      expect(() => execFileSync("python3", ["scripts/create-deployment-tar.py", dir, output], { stdio: "pipe" })).toThrow();
    } finally {
      rmSync(output, { force: true });
    }
  });
});
