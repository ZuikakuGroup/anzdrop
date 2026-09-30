import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
      execFileSync("node", ["scripts/create-deployment-tar.mjs", dir, first]);
      utimesSync(file, new Date(0), new Date("2030-01-01T00:00:00Z"));
      writeFileSync(readme, "generated at 2030-01-01T00:00:00Z");
      execFileSync("node", ["scripts/create-deployment-tar.mjs", dir, second]);
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
      expect(() => execFileSync("node", ["scripts/create-deployment-tar.mjs", dir, output], { stdio: "pipe" })).toThrow();
    } finally {
      rmSync(output, { force: true });
    }
  });

  it("removes stale extraction contents before reading the verified archive", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anzdrop-extraction-"));
    tempDirs.push(dir);
    const source = path.join(dir, "source");
    const temp = path.join(dir, "tmp");
    const extracted = path.join(temp, "auditable-extracted");
    mkdirSync(source);
    mkdirSync(extracted, { recursive: true });
    writeFileSync(path.join(extracted, "wrangler.jsonc"), '{"name":"stale"}');
    const archive = path.join(temp, "anzdrop-deploy.tar");
    execFileSync("node", ["scripts/create-deployment-tar.mjs", source, archive]);
    writeFileSync(`${archive}.sha256`, `${digest(archive)}  anzdrop-deploy.tar\n`);

    expect(() => execFileSync("node", [path.resolve("scripts/deploy-audited.mjs")], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_REF: "refs/heads/main",
        GITHUB_EVENT_NAME: "push",
        CLOUDFLARE_API_TOKEN: "test-token",
      },
      stdio: "pipe",
    })).toThrow();
    expect(existsSync(path.join(extracted, "wrangler.jsonc"))).toBe(false);
  });
});
