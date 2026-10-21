import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

type Manifest = { dependencies: Record<string, string> };
type Lock = { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
const require = createRequire(import.meta.url);

it("keeps the declared, locked, and installed React runtimes on the same version", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Manifest;
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as Lock;
  const version = manifest.dependencies.react;
  for (const name of ["react", "react-dom"]) {
    expect(manifest.dependencies[name]).toBe(version);
    expect(lock.packages[""].dependencies?.[name]).toBe(version);
    expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    expect((require(`${name}/package.json`) as { version: string }).version).toBe(version);
  }
});
