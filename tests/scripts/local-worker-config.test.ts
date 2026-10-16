import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalWorkerConfig } from "@/scripts/local-worker-config.mjs";

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe("disposable local Wrangler configuration", () => {
  it("resolves paths, removes cron/build settings, and preserves bindings and vars", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "anzdrop-local-config-"));
    const file = path.join(directory, "worker.jsonc");
    const config = { main: "./entry.ts", tsconfig: "tsconfig.json", triggers: { crons: ["0 * * * *"] },
      routes: ["example.com/*"], assets: { directory: "./public" }, vars: { LOCAL_DEVELOPMENT: "true" },
      services: [{ binding: "APP", service: "anzdrop" }], d1_databases: [{ binding: "DB", database_id: "synthetic", migrations_dir: "old" }] };
    await writeFile(file, `// JSONC input\n${JSON.stringify(config)}`);
    const local = await readLocalWorkerConfig(file);
    expect(local.main).toBe(path.join(directory, "entry.ts"));
    expect(local.assets.directory).toBe(path.join(directory, "public"));
    expect(local.d1_databases[0]).toEqual({ binding: "DB", database_id: "synthetic", migrations_dir: path.resolve("migrations") });
    expect(local.vars).toEqual(config.vars);
    expect(local.services).toEqual(config.services);
    expect(local.routes).toEqual(config.routes);
    expect(local).not.toHaveProperty("triggers");
    expect(local).not.toHaveProperty("tsconfig");
    expect(await readLocalWorkerConfig(file, { stripRoutes: true })).not.toHaveProperty("routes");
  });
  it("rejects invalid JSONC", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "anzdrop-local-config-"));
    const file = path.join(directory, "invalid.jsonc");
    await writeFile(file, "{ invalid");
    await expect(readLocalWorkerConfig(file)).rejects.toThrow("Invalid local Wrangler config");
  });
});
