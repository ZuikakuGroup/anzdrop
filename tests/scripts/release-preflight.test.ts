import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { readConfig, requiredAppSecrets } from "@/scripts/release-safety.mjs";
import { releasePreflight } from "@/scripts/release-preflight.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anzdrop-preflight-"));
  const production = await readConfig("wrangler.jsonc");
  const configs = await Promise.all(["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"].map(file => readConfig(file)));
  for (const [index, config] of configs.entries()) {
    config.account_id = production.account_id;
    config.preview_urls = false;
    if (index < 2) config.vars.DEPLOYMENT_ENV = "production";
  }
  await writeFile(path.join(directory, "wrangler.jsonc"), JSON.stringify(production));
  for (const [index, file] of ["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"].entries()) {
    const target = path.join(directory, "tmp/auditable-payload", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(configs[index]));
  }
  await writeFile(path.join(directory, "tmp/anzdrop-deploy.tar.sha256"), `${"a".repeat(64)}  anzdrop-deploy.tar\n`);
  const environment = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: "c".repeat(40), RELEASE_CONFIRMATION: "c".repeat(40), GITHUB_REPOSITORY: "ZuikakuGroup/anzdrop", CLOUDFLARE_API_TOKEN: "synthetic-cf-token", GH_TOKEN: "synthetic-github-token" };
  return { directory, production, environment };
}

function remoteResult(url: string, missingSecret = false) {
  if (url.endsWith("/environments/production")) return { protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }], prevent_self_review: true }], can_admins_bypass: false };
  if (url.includes("/d1/database/")) return { success: true, result: { uuid: url.split("/").at(-1), name: "anzdrop-db" } };
  if (url.includes("/r2/buckets/")) return { success: true, result: { name: "anzdrop" } };
  if (url.endsWith("/secrets")) return { success: true, result: url.endsWith("/anzdrop/secrets") ? (missingSecret ? [] : requiredAppSecrets.map(name => ({ name, type: "secret_text" }))) : [] };
  if (url.endsWith("/deployments")) return { success: true, result: { deployments: [{ id: "synthetic-deployment", versions: [{ version_id: "12345678-1234-4234-8234-123456789abc", percentage: 100 }] }] } };
  throw new Error("Unexpected preflight request");
}

it("checks only remote metadata and records the full baseline before a release can mutate anything", async () => {
  const { directory, environment } = await fixture();
  try {
    const requests: string[] = [];
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      requests.push(url);
      expect(options.method).toBeUndefined();
      return Response.json(remoteResult(url));
    });
    await releasePreflight("production", { environment, fetcher, directory });
    const baseline = JSON.parse(await readFile(path.join(directory, "tmp/pre-release-deployments.json"), "utf8"));
    expect(baseline.workers.map((row: { worker: string }) => row.worker)).toEqual(["anzdrop", "anzdrop-public", "anzdrop-router"]);
    expect(baseline.gitCommit).toBe(environment.GITHUB_SHA);
    expect(baseline.artifactSha256).toBe("a".repeat(64));
    expect(requests).toHaveLength(9);
    expect(JSON.stringify(baseline)).not.toContain(environment.CLOUDFLARE_API_TOKEN);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.each(["push", "wrong-sha", "missing-secret", "wrong-db", "unprotected-environment", "lookup-failure"])("fails closed on %s without producing a baseline", async failure => {
  const { directory, environment } = await fixture();
  if (failure === "push") environment.GITHUB_EVENT_NAME = "push";
  if (failure === "wrong-sha") environment.RELEASE_CONFIRMATION = "other";
  const fetcher = vi.fn(async (url: string) => {
    if (failure === "lookup-failure") return new Response(null, { status: 503 });
    const result = remoteResult(url, failure === "missing-secret");
    if (failure === "wrong-db" && url.includes("/d1/")) return Response.json({ success: true, result: { uuid: "other", name: "anzdrop-db" } });
    if (failure === "unprotected-environment" && url.endsWith("/environments/production")) return Response.json({});
    return Response.json(result);
  });
  try {
    await expect(releasePreflight("production", { environment, fetcher, directory })).rejects.toThrow();
    await expect(readFile(path.join(directory, "tmp/pre-release-deployments.json"))).rejects.toThrow();
    if (failure === "push" || failure === "wrong-sha") expect(fetcher).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
