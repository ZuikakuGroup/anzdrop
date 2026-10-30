import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertProductionApprovalPolicy, assertStagingAccess, assertReleaseConfigs, readConfig, validateStagingPlan } from "@/scripts/release-safety.mjs";
import { rollbackPlan } from "@/scripts/rollback-plan.mjs";

const production = await readConfig("wrangler.jsonc");
const plan = {
  accountId: "b".repeat(32), databaseId: "12345678-1234-4234-8234-123456789abc",
  databaseName: "anzdrop-staging-db", bucketName: "anzdrop-staging",
  origin: "https://staging.example.com", zoneName: "example.com",
  accessTeamDomain: "staging-team.cloudflareaccess.com", accessAud: "c".repeat(64),
};

describe("staging isolation", () => {
  it("generates isolated service/storage bindings without production integration values or scheduled deletion", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anzdrop-staging-"));
    const file = path.join(dir, "plan.json");
    try {
      writeFileSync(file, JSON.stringify(plan));
      execFileSync("node", ["scripts/prepare-staging-config.mjs"], { env: { ...process.env, STAGING_PLAN_FILE: file, STAGING_CONFIG_DIR: path.join(dir, "configs") }, stdio: "pipe" });
      const configs = await Promise.all(["wrangler.jsonc", "apps/public/wrangler.jsonc", "wrangler.router.jsonc"].map(file => readConfig(path.join(dir, "configs", file))));
      expect(() => assertReleaseConfigs(configs, "staging", production, plan)).not.toThrow();
      expect(configs[0].triggers).toBeUndefined();
      expect(JSON.stringify(configs)).not.toContain(production.d1_databases[0].database_id);
      expect(configs[0].vars).not.toHaveProperty("STRIPE_PRICE_ID_STANDARD");
      for (const mutate of [
        (c: typeof configs) => { c[0].d1_databases[0].database_id = production.d1_databases[0].database_id; },
        (c: typeof configs) => { c[0].r2_buckets[0].bucket_name = production.r2_buckets[0].bucket_name; },
        (c: typeof configs) => { c[1].services[0].service = "anzdrop"; },
        (c: typeof configs) => { c[2].routes[0].pattern = "anzdrop.com/*"; },
        (c: typeof configs) => { c[0].vars.LOCAL_ADMIN_BYPASS = "true"; },
        (c: typeof configs) => { c[0].ratelimits[0].namespace_id = production.ratelimits[0].namespace_id; },
        (c: typeof configs) => { c[0].triggers = { crons: ["0 */6 * * *"] }; },
        (c: typeof configs) => { c[1].workers_dev = true; },
      ]) {
        const changed = structuredClone(configs);
        mutate(changed);
        expect(() => assertReleaseConfigs(changed, "staging", production, plan)).toThrow();
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    { databaseId: production.d1_databases[0].database_id },
    { databaseName: production.d1_databases[0].database_name },
    { bucketName: production.r2_buckets[0].bucket_name },
    { origin: "https://anzdrop.com", zoneName: "anzdrop.com" },
    { origin: "https://staging.example.com/path" },
    { accountId: "REPLACE_ME" },
    { databaseId: "00000000-0000-0000-0000-000000000000" },
    { extraBinding: "production" },
  ])("rejects unsafe/unprovisioned staging plan %j", override => {
    expect(() => validateStagingPlan({ ...plan, ...override }, production)).toThrow();
  });

  it("allows a template only for local generation, never the release validator", () => {
    const template = JSON.parse(readFileSync("config/staging.example.json", "utf8"));
    expect(() => validateStagingPlan(template, production, { template: true })).not.toThrow();
    expect(() => validateStagingPlan(template, production)).toThrow();
  });
});

it("requires actual production reviewers and rejects unprotected/self-approvable environments", () => {
  expect(() => assertProductionApprovalPolicy({})).toThrow();
  expect(() => assertProductionApprovalPolicy({ protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }], prevent_self_review: false }], can_admins_bypass: false })).toThrow();
  expect(() => assertProductionApprovalPolicy({ protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }], prevent_self_review: true }], can_admins_bypass: true })).toThrow();
  expect(() => assertProductionApprovalPolicy({ protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }], prevent_self_review: true }], can_admins_bypass: false })).not.toThrow();
});

it("plans explicit recovery in reverse dependency order without guessing stable versions", () => {
  const source = { environment: "production", accountId: "a".repeat(32), workers: ["anzdrop", "anzdrop-public", "anzdrop-router"].map(worker => ({ worker, deployment: { versions: [{ version_id: "12345678-1234-4234-8234-123456789abc", percentage: 100 }] } })) };
  expect(() => rollbackPlan(source, "production", "b".repeat(32))).toThrow();
  const result = rollbackPlan(source, "production", source.accountId);
  expect(result.commands).toHaveLength(3);
  expect(result.commands[0]).toContain("--name anzdrop-router");
  expect(result.commands[2]).toContain("--name anzdrop --config wrangler.jsonc");
  expect(() => rollbackPlan(source, "staging", source.accountId)).toThrow();
  expect(() => rollbackPlan({ ...source, workers: source.workers.slice(1) }, "production", source.accountId)).toThrow();
  const gradual = structuredClone(source); gradual.workers[0].deployment.versions[0].percentage = 5;
  expect(() => rollbackPlan(gradual, "production", source.accountId)).toThrow();
  const injected = structuredClone(source); injected.workers[0].worker = "anzdrop; echo unsafe";
  expect(() => rollbackPlan(injected, "production", source.accountId)).toThrow();
});


it("requires an unauthenticated Access login challenge on staging HTML and API paths", async () => {
  const requests: string[] = [];
  await assertStagingAccess(plan, async (url: string, options: RequestInit) => {
    requests.push(url);
    expect(options.redirect).toBe("manual");
    expect(options.headers).toBeUndefined();
    return new Response(null, { status: 302, headers: { location: `https://${plan.accessTeamDomain}/cdn-cgi/access/login/staging.example.com` } });
  });
  expect(requests).toEqual([`${plan.origin}/`, `${plan.origin}/api/account/me`, `${plan.origin}/api/upload/start`]);
  for (const response of [
    new Response("public", { status: 200 }),
    new Response("application denial", { status: 403 }),
    new Response(null, { status: 302, headers: { location: "https://other.cloudflareaccess.com/cdn-cgi/access/login/" } }),
  ]) {
    await expect(assertStagingAccess(plan, async () => response)).rejects.toThrow("Staging must challenge");
  }
});
