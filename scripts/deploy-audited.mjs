import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import ts from "typescript";
import { parseDeployedVersion, selectDeployment } from "./deployment-provenance.mjs";

const root = process.cwd();
const artifact = path.join(root, "tmp/anzdrop-deploy.tar");
const extracted = path.join(root, "tmp/auditable-extracted");
const workers = [
  { config: "wrangler.jsonc", bundle: "compiled/app/custom-worker.js" },
  { config: "apps/home/wrangler.jsonc", bundle: "compiled/home/home-worker.js" },
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

async function readConfig(file) {
  const parsed = ts.parseConfigFileTextToJson(file, await readFile(file, "utf8"));
  if (parsed.error || !parsed.config?.name) throw new Error(`Invalid Wrangler config: ${file}`);
  return parsed.config;
}

async function findDeployment(accountId, workerName, versionId, startedAt, token) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/deployments`);
  url.searchParams.set("since", new Date(startedAt).toISOString());
  url.searchParams.set("per_page", "100");
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
  if (requiredEnvironment("GITHUB_REF") !== "refs/heads/main" || requiredEnvironment("GITHUB_EVENT_NAME") !== "push") {
    throw new Error("Production deployment requires a push to main");
  }
  const token = requiredEnvironment("CLOUDFLARE_API_TOKEN");
  const expected = (await readFile(`${artifact}.sha256`, "utf8")).trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(expected) || await sha256(artifact) !== expected) {
    throw new Error("Deployment archive SHA-256 does not match its recorded digest");
  }
  await mkdir(extracted, { recursive: true });
  await run("tar", ["-xf", artifact, "-C", extracted]);

  const appConfig = await readConfig(path.join(extracted, "wrangler.jsonc"));
  if (!/^[0-9a-f]{32}$/.test(appConfig.account_id)) throw new Error("Invalid Cloudflare account ID in Wrangler config");
  const accountId = appConfig.account_id;
  const configs = await Promise.all(workers.map((worker) => readConfig(path.join(extracted, worker.config))));
  if (
    new Set(configs.map((config) => config.name)).size !== workers.length ||
    configs.some((config) => config.account_id !== accountId) ||
    configs.slice(0, 2).some((config) => config.vars?.DEPLOYMENT_ENV !== "production")
  ) {
    throw new Error("Worker names, account IDs, or production settings do not match the archived deployment plan");
  }
  const productionUrl = appConfig.vars?.SITE_URL;
  if (
    !productionUrl ||
    !configs[2].routes?.some((route) => route.pattern === `${new URL(productionUrl).hostname}/*`)
  ) {
    throw new Error("Router route does not match the archived production URL");
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
    ], { OPEN_NEXT_DEPLOY: "true", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" });
    const versionId = parseDeployedVersion(output);
    const deployment = await findDeployment(accountId, name, versionId, startedAt, token);
    deploymentRecords.push({ worker: name, versionId, ...deployment });
    console.log(`Recorded ${name}: deployment ${deployment.deploymentId}, version ${versionId}`);
  }

  const manifest = {
    schemaVersion: 1,
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
