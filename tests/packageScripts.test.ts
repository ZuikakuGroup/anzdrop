import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
};

async function readPackageJson(): Promise<PackageJson> {
  const contents = await readFile(path.resolve(__dirname, "../package.json"), "utf8");
  return JSON.parse(contents) as PackageJson;
}

describe("package scripts", () => {
  it("binds the development server to the loopback interface", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts?.dev).toBe("next dev --webpack --hostname 127.0.0.1");
  });
});
