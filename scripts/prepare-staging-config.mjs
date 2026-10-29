import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertReleaseConfigs, readConfig, validateStagingPlan, workerNames } from "./release-safety.mjs";

const template = process.argv.includes("--template");
const archive = process.argv.includes("--archive");
const planPath = process.env.STAGING_PLAN_FILE ?? "config/staging.example.json";
const production = await readConfig("wrangler.jsonc");
const plan = validateStagingPlan(JSON.parse(await readFile(planPath, "utf8")), production, { template });
const base = archive ? "tmp/auditable-payload" : (process.env.STAGING_CONFIG_DIR ?? "tmp/staging-config");
const [appName, uiName, routerName] = workerNames.staging;
const app = {
  name: appName, account_id: plan.accountId, main: path.resolve("server/worker.ts"),
  compatibility_date: production.compatibility_date, compatibility_flags: production.compatibility_flags,
  workers_dev: false, preview_urls: false,
  vars: { SITE_URL: plan.origin, DEPLOYMENT_ENV: "staging", CF_ACCESS_TEAM_DOMAIN: plan.accessTeamDomain, CF_ACCESS_AUD: plan.accessAud },
  d1_databases: [{ binding: "DB", database_name: plan.databaseName, database_id: plan.databaseId, migrations_dir: archive ? "./migrations" : path.resolve("migrations") }],
  r2_buckets: [{ binding: "FILES_BUCKET", bucket_name: plan.bucketName }],
  ratelimits: production.ratelimits.map(rate => ({ ...rate, namespace_id: String(Number(rate.namespace_id) + 1000) })),
};
const ui = await readConfig(archive ? `${base}/apps/public/wrangler.jsonc` : "apps/public/wrangler.jsonc");
Object.assign(ui, { name: uiName, account_id: plan.accountId, workers_dev: false, preview_urls: false, vars: { SITE_URL: plan.origin, DEPLOYMENT_ENV: "staging" }, services: [{ binding: "APP", service: appName }] });
if (!archive) {
  ui.main = path.resolve("apps/public/dist/server/entry.mjs");
  ui.assets.directory = path.resolve("apps/public/dist/client");
}
const router = await readConfig("wrangler.router.jsonc");
Object.assign(router, { name: routerName, account_id: plan.accountId, main: path.resolve("workers/router/index.ts"), workers_dev: false, preview_urls: false, services: [{ binding: "APP", service: appName }, { binding: "PUBLIC", service: uiName }], routes: [{ pattern: `${new URL(plan.origin).hostname}/*`, zone_name: plan.zoneName }] });
assertReleaseConfigs([app, ui, router], "staging", production, plan);
for (const [file, config] of [["wrangler.jsonc", app], ["apps/public/wrangler.jsonc", ui], ["wrangler.router.jsonc", router]]) {
  const destination = path.join(base, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`);
}
console.log("Staging configs generated locally; no resources created");

if (process.env.GITHUB_OUTPUT && !template) await appendFile(process.env.GITHUB_OUTPUT, `staging_origin=${plan.origin}\n`);
