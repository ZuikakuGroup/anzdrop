import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertProductionApprovalPolicy, assertStagingAccess, assertReleaseConfigs, readConfig, requiredAppSecrets, validateStagingPlan } from "./release-safety.mjs";

/** @param {string} target @param {{environment?: Record<string, string | undefined>, fetcher?: (url: string, options: RequestInit) => Promise<Response>, directory?: string}} options */
export async function releasePreflight(target, { environment = process.env, fetcher = fetch, directory = process.cwd() } = {}) {
  const file = value => path.resolve(directory, value);
  if (!["production", "staging"].includes(target)) throw new Error("Expected production or staging");
  if (environment.GITHUB_REF !== "refs/heads/main" || !["push", "workflow_dispatch"].includes(environment.GITHUB_EVENT_NAME) || !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? "")) throw new Error("Remote releases require a trusted main event and exact commit SHA");
  if (target === "production" && (environment.GITHUB_EVENT_NAME !== "workflow_dispatch" || environment.RELEASE_CONFIRMATION !== environment.GITHUB_SHA)) throw new Error("Production requires explicit dispatch confirmation of the exact commit SHA");
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Missing Cloudflare API token");
  const production = await readConfig(file("wrangler.jsonc"));
  const plan = target === "staging" ? validateStagingPlan(JSON.parse(await readFile(file(environment.STAGING_PLAN_FILE ?? "config/staging.example.json"), "utf8")), production) : null;
  const configs = await Promise.all(["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"].map(file => readConfig(path.resolve(directory, `tmp/auditable-payload/${file}`))));
  assertReleaseConfigs(configs, target, production, plan);
  if (target === "staging") await assertStagingAccess(plan, fetcher);
  async function cloudflare(resource) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${configs[0].account_id}/${resource}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Preflight resource lookup failed (HTTP ${response.status})`);
    const body = await response.json();
    if (!body.success) throw new Error("Preflight resource lookup failed");
    return body.result;
  }
  const db = configs[0].d1_databases[0], bucket = configs[0].r2_buckets[0];
  const database = await cloudflare(`d1/database/${db.database_id}`);
  if (database.uuid !== db.database_id || database.name !== db.database_name) throw new Error("Remote D1 identity mismatch");
  const remoteBucket = await cloudflare(`r2/buckets/${bucket.bucket_name}`);
  if (remoteBucket.name !== bucket.bucket_name) throw new Error("Remote R2 identity mismatch");
  for (const [index, config] of configs.entries()) {
    const secrets = await cloudflare(`workers/scripts/${config.name}/secrets`);
    if (!Array.isArray(secrets)) throw new Error("Invalid secrets metadata");
    const names = new Set(secrets.map(secret => secret.name));
    if (index === 0 && requiredAppSecrets.some(name => !names.has(name))) throw new Error("Required account/upload secrets are missing");
    if (index !== 0 && names.size) throw new Error("PUBLIC and router must not hold application secrets");
    if (target === "staging" && ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_ACCOUNT_ID", "STRIPE_SECRET_KEY", "OPENNODE_API_KEY"].some(name => names.has(name))) throw new Error("Staging defaults to proxy uploads and disabled billing; remove direct-upload/payment credentials");
  }
  if (target === "production") {
    const response = await fetcher(`https://api.github.com/repos/${environment.GITHUB_REPOSITORY}/environments/production`, { headers: { Authorization: `Bearer ${environment.GH_TOKEN}`, Accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Cannot verify production approval protection");
    assertProductionApprovalPolicy(await response.json());
  }
  const before = [];
  for (const config of configs) {
    const history = await cloudflare(`workers/scripts/${config.name}/deployments`);
    const active = history?.deployments?.[0];
    if (!active?.versions?.length) throw new Error("Pre-release deployment history is missing; bootstrap separately");
    before.push({ worker: config.name, deployment: active });
  }
  const digest = (await readFile(file("tmp/anzdrop-deploy.tar.sha256"), "utf8")).trim().split(/\s+/)[0];
  await writeFile(file("tmp/pre-release-deployments.json"), `${JSON.stringify({ environment: target, accountId: configs[0].account_id, gitCommit: environment.GITHUB_SHA, artifactSha256: digest, workers: before }, null, 2)}\n`);
  console.log(`Release preflight passed for ${target}; secret values were not read`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await releasePreflight(process.argv[2]);
