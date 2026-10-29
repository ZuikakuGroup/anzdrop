import { readFile } from "node:fs/promises";
import ts from "typescript";

export const workerNames = {
  production: ["anzdrop", "anzdrop-public", "anzdrop-router"],
  staging: ["anzdrop-staging", "anzdrop-public-staging", "anzdrop-router-staging"],
};
export const requiredAppSecrets = ["TURNSTILE_SECRET_KEY", "SESSION_SECRET", "ACCOUNT_AUTH_ENCRYPTION_KEY"];
export async function readConfig(file) {
  const parsed = ts.parseConfigFileTextToJson(file, await readFile(file, "utf8"));
  if (parsed.error || !parsed.config?.name) throw new Error(`Invalid Wrangler config: ${file}`);
  return parsed.config;
}

export function validateStagingPlan(plan, production, { template = false } = {}) {
  const fields = ["accountId", "databaseId", "databaseName", "bucketName", "origin", "zoneName", "accessTeamDomain", "accessAud"];
  if (!plan || fields.some(key => typeof plan[key] !== "string" || !plan[key]) || Object.keys(plan).some(key => !fields.includes(key))) throw new Error("Invalid staging plan fields");
  const origin = new URL(plan.origin);
  if (origin.protocol !== "https:" || origin.origin !== plan.origin || origin.port || !origin.hostname.startsWith("staging.") || origin.hostname !== `staging.${plan.zoneName}`) throw new Error("Staging requires a dedicated staging.<zone> HTTPS origin");
  if (plan.origin === production.vars.SITE_URL || production.d1_databases.some(db => db.database_id === plan.databaseId || db.database_name === plan.databaseName) || production.r2_buckets.some(bucket => bucket.bucket_name === plan.bucketName)) throw new Error("Staging must not use production storage or origin");
  if (plan.accessAud === production.vars.CF_ACCESS_AUD) throw new Error("Staging requires a distinct Access audience");
  if (plan.databaseName !== "anzdrop-staging-db" || plan.bucketName !== "anzdrop-staging") throw new Error("Unexpected staging storage names");
  if (!template && (!/^[a-f0-9]{32}$/.test(plan.accountId) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(plan.databaseId) || /^0+$/.test(plan.databaseId.replaceAll("-", "")) || origin.hostname.endsWith(".invalid") || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(plan.accessTeamDomain) || !/^[a-f0-9]{64}$/.test(plan.accessAud))) throw new Error("Staging resources and Access must be provisioned before release");
  return plan;
}

export function assertReleaseConfigs(configs, target, production, plan) {
  if (!workerNames[target]) throw new Error("Unknown release target");
  const [app, ui, router] = configs;
  const names = workerNames[target];
  const origin = target === "staging" ? plan.origin : production.vars.SITE_URL;
  const account = target === "staging" ? plan.accountId : production.account_id;
  if (configs.length !== 3 || configs.some((c, i) => c.name !== names[i] || c.account_id !== account || c.workers_dev !== false || c.preview_urls !== false || c.env)) throw new Error("Worker identity or exposure does not match release target");
  if ([app, ui].some(c => c.vars?.SITE_URL !== origin || c.vars?.DEPLOYMENT_ENV !== target || c.vars?.LOCAL_DEVELOPMENT || c.vars?.LOCAL_ADMIN_BYPASS)) throw new Error("Unsafe release environment variables");
  if (app.d1_databases?.length !== 1 || app.d1_databases[0].binding !== "DB" || app.r2_buckets?.length !== 1 || app.r2_buckets[0].binding !== "FILES_BUCKET") throw new Error("Unexpected storage bindings");
  const db = app.d1_databases[0], bucket = app.r2_buckets[0];
  const expectedDb = target === "staging" ? plan.databaseId : production.d1_databases[0].database_id;
  const expectedBucket = target === "staging" ? plan.bucketName : production.r2_buckets[0].bucket_name;
  if (db.database_id !== expectedDb || bucket.bucket_name !== expectedBucket || db.preview_database_id || bucket.preview_bucket_name || db.remote || bucket.remote) throw new Error("Storage identity does not match release target");
  if ([ui, router].some(c => c.d1_databases?.length || c.r2_buckets?.length) || app.services?.length || JSON.stringify(ui.services) !== JSON.stringify([{ binding: "APP", service: names[0] }]) || JSON.stringify(router.services) !== JSON.stringify([{ binding: "APP", service: names[0] }, { binding: "PUBLIC", service: names[1] }])) throw new Error("Service bindings must remain within the release environment");
  if (app.routes?.length || ui.routes?.length || router.routes?.length !== 1 || router.routes[0].pattern !== `${new URL(origin).hostname}/*`) throw new Error("Unexpected release routes");
  if (target === "staging") {
    const allowed = new Set(["$schema", "name", "account_id", "main", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "vars", "d1_databases", "r2_buckets", "ratelimits", "services", "routes", "assets", "no_bundle", "find_additional_modules", "rules"]);
    if (configs.some(c => Object.keys(c).some(key => !allowed.has(key)))) throw new Error("Unreviewed staging configuration/binding");
    if (Object.keys(app.vars).some(key => !["SITE_URL", "DEPLOYMENT_ENV", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD"].includes(key)) || Object.keys(ui.vars).some(key => !["SITE_URL", "DEPLOYMENT_ENV"].includes(key))) throw new Error("Unreviewed staging integration variables");
    if (db.database_name !== plan.databaseName || bucket.bucket_name !== plan.bucketName) throw new Error("Staging storage name mismatch");
  }
  if (target === "staging" && (app.triggers?.crons?.length || app.ratelimits?.some(rate => production.ratelimits.some(prod => prod.namespace_id === rate.namespace_id)))) throw new Error("Staging must isolate rate limits and leave scheduled deletion disabled");
}

export function assertProductionApprovalPolicy(environment) {
  const reviewers = environment?.protection_rules?.find(rule => rule.type === "required_reviewers");
  if (!reviewers?.reviewers?.length || reviewers.prevent_self_review !== true || environment.can_admins_bypass !== false) throw new Error("Production environment requires reviewers, no self-review, and no admin bypass");
}


// Test the unauthenticated path too: valid service credentials alone cannot
// prove the staging host is protected against public access.
/** @param {{origin: string, accessTeamDomain: string}} plan @param {(url: string, options: RequestInit) => Promise<Response>} fetcher */
export async function assertStagingAccess(plan, fetcher = fetch) {
  for (const pathname of ["/", "/api/account/me", "/api/upload/start"]) {
    const response = await fetcher(`${plan.origin}${pathname}`, {
      redirect: "manual", signal: AbortSignal.timeout(20_000),
    });
    const location = response.headers.get("location");
    await response.body?.cancel();
    let login;
    try { login = location ? new URL(location) : null; } catch { login = null; }
    if (![302, 303].includes(response.status) || login?.origin !== `https://${plan.accessTeamDomain}` || !login.pathname.startsWith("/cdn-cgi/access/login")) {
      throw new Error("Staging must challenge unauthenticated requests through its configured Access team");
    }
  }
}
