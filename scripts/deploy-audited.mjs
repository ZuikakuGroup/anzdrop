import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { assertReleaseConfigs, readConfig, validateStagingPlan } from "./release-safety.mjs";
import { parseDeployedVersion, selectDeployment } from "./deployment-provenance.mjs";

const root = process.cwd();
const artifact = path.join(root, "tmp/anzdrop-deploy.tar");
const extracted = path.join(root, "tmp/auditable-extracted");
const workers = [
  { config: "wrangler.jsonc", bundle: "compiled/app/worker.js" },
  { config: "apps/public/wrangler.jsonc", bundle: "compiled/public/entry.mjs" },
  { config: "wrangler.router.jsonc", bundle: "compiled/router/index.js" },
];

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function run(executable, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 4_000_000) child.kill();
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${path.basename(executable)} exited with ${code}; inspect the run in a secure environment`));
      else resolve(output);
    });
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function findDeployment(accountId, workerName, versionId, startedAt, token) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/deployments`);
  url.searchParams.set("since", new Date(startedAt).toISOString());
  url.searchParams.set("per_page", "100");
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Cloudflare deployment lookup failed (HTTP ${response.status})`);
    const body = await response.json();
    if (!body.success || !Array.isArray(body.result?.deployments)) {
      throw new Error("Cloudflare returned an invalid deployment response");
    }
    if ((body.result_info?.total_pages ?? 1) > 1) {
      throw new Error("Cloudflare deployment response was paginated; cannot identify the run safely");
    }
    const found = selectDeployment(body.result.deployments, versionId, startedAt);
    if (found) return found;
    if (attempt < 5) await setTimeout(2000);
  }
  throw new Error(`No deployment for the version just uploaded to ${workerName}`);
}

async function main() {
  const target = process.argv[2] ?? "production";
  if (!["production", "staging"].includes(target) || requiredEnvironment("GITHUB_REF") !== "refs/heads/main") throw new Error("Releases require main and a known target");
  if (target === "production" && (requiredEnvironment("GITHUB_EVENT_NAME") !== "workflow_dispatch" || requiredEnvironment("RELEASE_CONFIRMATION") !== requiredEnvironment("GITHUB_SHA"))) throw new Error("Production deployment requires explicit confirmation of the exact SHA");
  const token = requiredEnvironment("CLOUDFLARE_API_TOKEN");
  const expected = (await readFile(`${artifact}.sha256`, "utf8")).trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(expected) || await sha256(artifact) !== expected) {
    throw new Error("Deployment archive SHA-256 does not match its recorded digest");
  }
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });
  await run("tar", ["-xf", artifact, "-C", extracted]);

  const appConfig = await readConfig(path.join(extracted, "wrangler.jsonc"));
  if (!/^[0-9a-f]{32}$/.test(appConfig.account_id)) throw new Error("Invalid Cloudflare account ID in Wrangler config");
  const accountId = appConfig.account_id;
  const configs = await Promise.all(workers.map((worker) => readConfig(path.join(extracted, worker.config))));
  if (
    new Set(configs.map((config) => config.name)).size !== workers.length ||
    configs.some((config) => config.account_id !== accountId) ||
    configs.slice(0, 2).some((config) => config.vars?.DEPLOYMENT_ENV !== target)
  ) {
    throw new Error("Worker names, account IDs, or production settings do not match the archived deployment plan");
  }
  const production = await readConfig(path.join(root, "wrangler.jsonc"));
  const plan = target === "staging" ? validateStagingPlan(JSON.parse(await readFile(process.env.STAGING_PLAN_FILE ?? "config/staging.example.json", "utf8")), production) : null;
  assertReleaseConfigs(configs, target, production, plan);
  const productionUrl = appConfig.vars?.SITE_URL;
  if (
    !productionUrl ||
    !configs[2].routes?.some((route) => route.pattern === `${new URL(productionUrl).hostname}/*`)
  ) {
    throw new Error("Router route does not match the archived production URL");
  }
  // Baseline was captured by preflight before any D1 migrations. Preserve it
  // even if migrations or a later Worker deployment fail.
  const baseline = JSON.parse(await readFile(path.join(root, "tmp/pre-release-deployments.json"), "utf8"));
  if (baseline.environment !== target || baseline.accountId !== accountId || baseline.gitCommit !== process.env.GITHUB_SHA || baseline.artifactSha256 !== expected || baseline.workers?.length !== 3) throw new Error("Missing or stale release preflight baseline");
  for (const config of configs) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${config.name}/deployments`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Cannot verify pre-release deployments");
    const body = await response.json();
    const active = body.result?.deployments?.[0];
    const previous = baseline.workers.find(worker => worker.worker === config.name)?.deployment;
    if (!body.success || !active?.versions?.length || JSON.stringify(active.versions) !== JSON.stringify(previous?.versions)) throw new Error("Active versions changed since preflight; stop and review");
  }
  const deploymentRecords = [];

  for (const [index, worker] of workers.entries()) {
    const configPath = path.join(extracted, worker.config);
    const name = configs[index].name;
    const startedAt = Date.now() - 5000;
    console.log(`Deploying ${name} from the verified archive`);
    const output = await run(path.join(root, "node_modules/.bin/wrangler"), [
      "deploy", path.join(extracted, worker.bundle), "--config", configPath,
      "--no-bundle", "--message", `GitHub Actions ${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT} ${process.env.GITHUB_SHA}`,
    ], { CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" });
    const versionId = parseDeployedVersion(output);
    const record = { worker: name, versionId, lookupPending: true };
    deploymentRecords.push(record);
    const saveProgress = () => writeFile(path.join(root, "tmp/partial-deployment-records.json"), `${JSON.stringify({ environment: target, accountId, deployments: deploymentRecords }, null, 2)}\n`);
    await saveProgress();
    console.log(`Uploaded ${name}: version ${versionId}; identifying its deployment`);
    const deployment = await findDeployment(accountId, name, versionId, startedAt, token);
    Object.assign(record, deployment, { lookupPending: false });
    await saveProgress();
    console.log(`Recorded ${name}: deployment ${deployment.deploymentId}, version ${versionId}`);
  }

  const manifest = {
    schemaVersion: 1,
    environment: target,
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    gitCommit: requiredEnvironment("GITHUB_SHA"),
    gitRef: requiredEnvironment("GITHUB_REF"),
    workflow: ".github/workflows/deploy.yml",
    workflowRunId: requiredEnvironment("GITHUB_RUN_ID"),
    workflowRunAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
    artifact: { file: path.basename(artifact), sha256: `sha256:${expected}` },
    cloudflare: {
      platform: "workers",
      accountId,
      productionUrl,
      deployments: deploymentRecords,
    },
    deployedAt: deploymentRecords.at(-1).deployedAt,
  };
  await writeFile(path.join(root, "tmp/deployment-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log("Deployment manifest created after all three Workers deployments succeeded");
}

await main();
