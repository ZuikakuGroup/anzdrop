import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("three-Worker production archive configuration", () => {
  it("pins production settings and account IDs while retaining service and storage bindings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anzdrop-production-"));
    try {
      const configs = [
        { name: "anzdrop", main: "server/worker.ts", account_id: "a".repeat(32), vars: { SITE_URL: "https://anzdrop.com" }, d1_databases: [{ binding: "DB", database_id: "existing" }], triggers: { crons: ["0 */6 * * *"] } },
        { name: "anzdrop-public", main: "unused", services: [{ binding: "APP", service: "anzdrop" }], assets: { directory: "dist/client" } },
        { name: "anzdrop-router", main: "workers/router/index.ts", services: [{ binding: "APP", service: "anzdrop" }, { binding: "PUBLIC", service: "anzdrop-public" }], routes: [{ pattern: "anzdrop.com/*" }] },
      ];
      const files = configs.map((config, index) => {
        const file = path.join(dir, `${index}/wrangler.json`);
        mkdirSync(path.dirname(file)); writeFileSync(file, JSON.stringify(config)); return file;
      });
      execFileSync("node", ["scripts/prepare-production-config.mjs", ...files]);
      const result = files.map(file => JSON.parse(readFileSync(file, "utf8")));
      expect(result.map(config => config.account_id)).toEqual(Array(3).fill("a".repeat(32)));
      expect(result[0].vars.DEPLOYMENT_ENV).toBe("production");
      expect(result[1].vars.DEPLOYMENT_ENV).toBe("production");
      expect(result[2].vars).toBeUndefined();
      expect(result[0].d1_databases).toEqual(configs[0].d1_databases);
      expect(result[0].triggers).toEqual(configs[0].triggers);
      expect(result[1].services).toEqual(configs[1].services);
      expect(result[1].main).toBe("../../compiled/public/entry.mjs");
      expect(result[1].no_bundle).toBe(true);
      expect(result[1].d1_databases).toBeUndefined();
      expect(result[2].services).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
