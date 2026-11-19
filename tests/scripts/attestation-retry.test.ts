import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Outcome = "success" | "failure" | "skipped";
type Step = {
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  shell?: string;
  with?: Record<string, string>;
  "continue-on-error"?: boolean;
};

const action = parse(readFileSync(".github/actions/attest-with-retry/action.yml", "utf8"));
const workflow = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));

// Execute the YAML's conditions with fake attestation outcomes, without signing
// or sleeping. outcome deliberately differs from conclusion on tolerated errors.
function simulate(outcomes: Outcome[], cancelAfterAttempts = Infinity) {
  const steps: Record<string, { outcome: Outcome; conclusion: Outcome }> = {};
  const waits: string[] = [];
  let attempts = 0;
  let failed = false;
  for (const step of action.runs.steps as Step[]) {
    const cancelled = () => attempts >= cancelAfterAttempts;
    const enabled = step.if
      ? runInNewContext(step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), { steps, cancelled })
      : !failed && !cancelled();
    let outcome: Outcome = "skipped";
    if (enabled) {
      if (step.uses) {
        outcome = outcomes[attempts++] ?? "failure";
      } else {
        waits.push(step.run!);
        outcome = "success";
      }
    }
    const conclusion = outcome === "failure" && step["continue-on-error"] ? "success" : outcome;
    if (step.id) steps[step.id] = { outcome, conclusion };
    if (conclusion === "failure") failed = true;
  }
  return { attempts, waits, failed };
}

describe("deployment attestation retries", () => {
  it.each([
    { outcomes: ["success"], attempts: 1, waits: [], failed: false },
    { outcomes: ["failure", "success"], attempts: 2, waits: ["sleep 30"], failed: false },
    { outcomes: ["failure", "failure", "success"], attempts: 3, waits: ["sleep 30", "sleep 60"], failed: false },
    { outcomes: ["failure", "failure", "failure"], attempts: 3, waits: ["sleep 30", "sleep 60"], failed: true },
  ])("handles $outcomes with a bounded retry and fails closed", ({ outcomes, ...expected }) => {
    expect(simulate(outcomes as Outcome[])).toEqual(expected);
  });

  it.each([0, 1, 2])("does not sign or wait after cancellation at attempt %i", (cancelAfter) => {
    expect(simulate(["failure", "failure", "failure"], cancelAfter)).toMatchObject({
      attempts: cancelAfter,
      waits: cancelAfter === 2 ? ["sleep 30"] : [],
    });
  });

  it("always signs the same archive and keeps the final failure fatal", () => {
    expect(action.runs.using).toBe("composite");
    const attempts = (action.runs.steps as Step[]).filter((step) => step.uses);
    expect(attempts).toHaveLength(3);
    for (const step of attempts) {
      expect(step.uses).toBe("actions/attest@v4");
      expect(step.with).toEqual({ "subject-path": "tmp/anzdrop-deploy.tar" });
    }
    expect(attempts.at(-1)?.["continue-on-error"]).not.toBe(true);
  });

  it.each(["build", "staging"])("requires signing before publishing or deploying in %s", (jobName) => {
    const job = workflow.jobs[jobName];
    const steps = job.steps as Step[];
    const signingIndex = steps.findIndex((step) => step.uses === "./.github/actions/attest-with-retry");
    expect(signingIndex).toBeGreaterThan(steps.findIndex((step) => step.uses?.startsWith("actions/checkout@")));
    expect(signingIndex).toBeGreaterThan(-1);
    expect(steps[signingIndex]["continue-on-error"]).not.toBe(true);
    expect(steps[signingIndex].if).toBeUndefined();
    const publishing = steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@") || step.run?.includes("migrations apply") || step.run?.includes("deploy-audited.mjs"));
    expect(publishing.length).toBeGreaterThan(0);
    for (const step of publishing) {
      expect(steps.indexOf(step)).toBeGreaterThan(signingIndex);
      // Staging's always() upload preserves failure evidence; it cannot deploy.
      if (step.run) expect(step.if).toBeUndefined();
    }
    expect(job.permissions["id-token"]).toBe("write");
    expect(job.permissions.attestations).toBe("write");
  });
});
