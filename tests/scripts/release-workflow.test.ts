import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
it("gates production on successful staging and explicit main SHA approval without PR secrets", () => {
  expect(workflow.on.pull_request).toBeUndefined();
  expect(workflow.on.pull_request_target).toBeUndefined();
  expect(workflow.on.workflow_dispatch.inputs.production_commit_sha).toBeDefined();
  expect(workflow.jobs.build.if).toContain("refs/heads/main");
  expect(workflow.jobs.staging.needs).toBe("build");
  expect(workflow.jobs.staging.environment).toBe("staging");
  expect(workflow.jobs.deploy.needs).toEqual(["build", "staging"]);
  expect(workflow.jobs.deploy.if).toContain("workflow_dispatch");
  expect(workflow.jobs.deploy.environment).toBe("production");
  const commands = workflow.jobs.deploy.steps.map((step: { run?: string }) => step.run ?? "");
  expect(commands.findIndex((command: string) => command.includes("release-preflight"))).toBeLessThan(commands.findIndex((command: string) => command.includes("migrations apply")));
  expect(commands.findIndex((command: string) => command.includes("attestation verify"))).toBeLessThan(commands.findIndex((command: string) => command.includes("migrations apply")));
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  for (const job of Object.values(workflow.jobs) as { steps: { uses?: string; env?: Record<string, string> }[] }[]) {
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout")) expect(step).toHaveProperty("with.persist-credentials", false);
      if (step.env?.CLOUDFLARE_API_TOKEN) expect(step.uses).not.toBeDefined();
    }
  }
});
it("keeps production post-deploy smoke read-only and staging credentials out of browser trace artifacts", () => {
  const postDeploy = parse(readFileSync(".github/workflows/e2e.yml", "utf8"));
  expect(postDeploy.jobs.e2e.steps.some((step: { run?: string }) => step.run?.includes("release-smoke.mjs"))).toBe(true);
  expect(postDeploy.jobs.e2e.steps.some((step: { run?: string }) => step.run?.includes("playwright test"))).toBe(false);
  const staging = readFileSync("tests/e2e/release-staging.spec.ts", "utf8");
  expect(staging).toContain('trace: "off"');
  expect(staging).toContain('serviceWorkers: "block"');
});
