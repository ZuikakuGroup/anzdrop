import { readFile } from "node:fs/promises";
import { readConfig, validateStagingPlan, workerNames } from "./release-safety.mjs";

// Read-only planner. Never infer "stable" from "latest", and never restore data.
export function rollbackPlan(record, target, expectedAccountId) {
  const expected = workerNames[target];
  const account = record.accountId ?? record.cloudflare?.accountId;
  const environment = record.environment ?? (record.gitRef === "refs/heads/main" && record.cloudflare?.productionUrl === "https://anzdrop.com" ? "production" : undefined);
  if (!expectedAccountId || account !== expectedAccountId || !expected || environment !== target || !/^[a-f0-9]{32}$/.test(record.accountId ?? record.cloudflare?.accountId ?? "")) throw new Error("Recovery environment/account mismatch");
  const rows = record.workers ? record.workers.map(row => {
    if (row.deployment?.versions?.length !== 1 || row.deployment.versions[0].percentage !== 100) throw new Error("Recovery source must be a single version at 100%; review gradual deployments manually");
    return { worker: row.worker, versionId: row.deployment.versions[0].version_id };
  }) : record.cloudflare?.deployments;
  if (!Array.isArray(rows) || rows.length !== 3 || new Set(rows.map(row => row.worker)).size !== 3 || rows.some(row => !expected.includes(row.worker) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.versionId))) throw new Error("Recovery source must identify exactly the expected three Worker versions");
  const accountId = record.accountId ?? record.cloudflare.accountId;
  return {
    environment: target, accountId,
    warning: "Confirm this is a stable set and still compatible with the current D1 schema, R2 data and secrets. Commands restore code/config/assets only, not data or external resources.",
    commands: [...expected].reverse().map(worker => {
      const version = rows.find(row => row.worker === worker).versionId;
      const index = expected.indexOf(worker);
      const file = ["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"][index];
      const config = target === "staging" ? `tmp/staging-config/${file}` : file;
      return `CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler rollback ${version} --name ${worker} --config ${config}`;
    }),
  };
}
if (process.argv[1]?.endsWith("/rollback-plan.mjs")) {
  if (process.argv.length !== 4) throw new Error("Usage: node scripts/rollback-plan.mjs <trusted-record.json> <production|staging>");
  const target = process.argv[3];
  const production = await readConfig("wrangler.jsonc");
  const account = target === "staging" ? validateStagingPlan(JSON.parse(await readFile(process.env.STAGING_PLAN_FILE ?? "config/staging.example.json", "utf8")), production).accountId : production.account_id;
  console.log(JSON.stringify(rollbackPlan(JSON.parse(await readFile(process.argv[2], "utf8")), target, account), null, 2));
}
