import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { readConfig } from "@/scripts/release-safety.mjs";

it("retains the uploaded Version ID and previous versions when deployment lookup fails", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anzdrop-partial-release-"));
  const script = path.resolve("scripts/deploy-audited.mjs");
  const previousVersion = "11111111-1111-4111-8111-111111111111";
  const uploadedVersion = "22222222-2222-4222-8222-222222222222";
  const sha = "c".repeat(40);
  try {
    const production = await readConfig("wrangler.jsonc");
    const configFiles = ["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"];
    const configs = await Promise.all(configFiles.map(file => readConfig(file)));
    writeFileSync(path.join(directory, "wrangler.jsonc"), JSON.stringify(production));
    for (const [index, config] of configs.entries()) {
      config.account_id = production.account_id;
      config.preview_urls = false;
      if (index < 2) config.vars.DEPLOYMENT_ENV = "production";
      const target = path.join(directory, "source", configFiles[index]);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(config));
    }
    const temporary = path.join(directory, "tmp");
    mkdirSync(temporary);
    const archive = path.join(temporary, "anzdrop-deploy.tar");
    execFileSync("node", ["scripts/create-deployment-tar.mjs", path.join(directory, "source"), archive]);
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(`${archive}.sha256`, `${digest}  anzdrop-deploy.tar\n`);
    const baseline = { environment: "production", accountId: production.account_id, gitCommit: sha, artifactSha256: digest,
      workers: configs.map(config => ({ worker: config.name, deployment: { versions: [{ version_id: previousVersion, percentage: 100 }] } })),
    };
    const baselinePath = path.join(temporary, "pre-release-deployments.json");
    writeFileSync(baselinePath, JSON.stringify(baseline));
    const binary = path.join(directory, "node_modules/.bin/wrangler");
    mkdirSync(path.dirname(binary), { recursive: true });
    writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync('wrangler-calls.txt', 'deploy\\n');\nconsole.log('Current Version ID: ${uploadedVersion}');\n`, { mode: 0o755 });
    const preload = path.join(directory, "mock-fetch.mjs");
    writeFileSync(preload, `globalThis.fetch = async input => {
      const url = new URL(input);
      if (url.hostname !== 'api.cloudflare.com' || !url.pathname.endsWith('/deployments')) throw new Error('Unexpected network request');
      if (url.searchParams.has('since')) return new Response(null, { status: 503 });
      return Response.json({success:true,result:{deployments:[{versions:[{version_id:'${previousVersion}',percentage:100}]}]}});
    };`);
    expect(() => execFileSync("node", ["--import", preload, script, "production"], {
      cwd: directory, stdio: "pipe", env: { ...process.env,
        GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: sha,
        RELEASE_CONFIRMATION: sha, CLOUDFLARE_API_TOKEN: "synthetic-token",
        GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
      },
    })).toThrow();
    const progress = JSON.parse(readFileSync(path.join(temporary, "partial-deployment-records.json"), "utf8"));
    expect(progress.deployments).toEqual([{ worker: "anzdrop", versionId: uploadedVersion, lookupPending: true }]);
    expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual(baseline);
    expect(readFileSync(path.join(directory, "wrangler-calls.txt"), "utf8")).toBe("deploy\n");
    expect(existsSync(path.join(temporary, "deployment-manifest.json"))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
