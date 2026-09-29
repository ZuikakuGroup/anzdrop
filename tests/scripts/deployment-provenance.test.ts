import { describe, expect, it } from "vitest";
import { parseDeployedVersion, selectDeployment } from "@/scripts/deployment-provenance.mjs";

const versionId = "11111111-1111-4111-8111-111111111111";
const deploymentId = "22222222-2222-4222-8222-222222222222";
const startedAt = Date.parse("2026-09-30T00:00:00Z");

describe("Workers deployment provenance", () => {
  it("reads the version returned by this deployment command", () => {
    expect(parseDeployedVersion(`Uploaded anzdrop\nCurrent Version ID: ${versionId}\n`)).toBe(versionId);
    expect(() => parseDeployedVersion("Upload succeeded, no ID available")).toThrow();
    expect(() => parseDeployedVersion(`Current Version ID: ${versionId}\nCurrent Version ID: ${versionId}`)).toThrow();
  });

  it("matches the deployment by its exact version, even when a newer deployment exists", () => {
    const deployments = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        created_on: "2026-09-30T00:02:00Z",
        versions: [{ version_id: "44444444-4444-4444-8444-444444444444", percentage: 100 }],
      },
      {
        id: deploymentId,
        created_on: "2026-09-30T00:01:00Z",
        versions: [{ version_id: versionId, percentage: 100 }],
      },
    ];
    expect(selectDeployment(deployments, versionId, startedAt)).toEqual({
      deploymentId,
      deployedAt: "2026-09-30T00:01:00Z",
    });
  });

  it("rejects ambiguous, older, or partial deployments", () => {
    const matching = {
      id: deploymentId,
      created_on: "2026-09-30T00:01:00Z",
      versions: [{ version_id: versionId, percentage: 100 }],
    };
    expect(selectDeployment([], versionId, startedAt)).toBeNull();
    expect(() => selectDeployment([matching, { ...matching, id: "55555555-5555-4555-8555-555555555555" }], versionId, startedAt)).toThrow();
    expect(() => selectDeployment([{ ...matching, created_on: "2026-09-29T23:59:59Z" }], versionId, startedAt)).toThrow();
    expect(() => selectDeployment([{ ...matching, versions: [{ version_id: versionId, percentage: 50 }] }], versionId, startedAt)).toThrow();
  });
});
