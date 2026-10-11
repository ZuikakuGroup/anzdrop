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

    expect(packageJson.scripts?.dev).toBe("node --env-file-if-exists=.env.local scripts/dev-app.mjs");
    expect(packageJson.scripts?.["dev:api"]).toContain("scripts/dev-api.mjs");
    const apiScript = await readFile(path.resolve(__dirname, "../scripts/dev-api.mjs"), "utf8");
    expect(apiScript).toContain("'--ip', '127.0.0.1'");
    expect(packageJson.scripts?.["dev:app"]).toContain("--host localhost");
    expect(packageJson.scripts?.["dev:legacy"]).toBeUndefined();
  });

  it("runs the home-page measurement as plain JavaScript", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts?.["measure:home"]).toBe(
      "node scripts/measure-home.mjs"
    );
  });
});
