const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the version created by this exact Wrangler invocation, never "latest". */
export function parseDeployedVersion(output) {
  const versions = [...output.matchAll(/^Current Version ID:\s*([0-9a-f-]+)\s*$/gim)]
    .map((match) => match[1]);
  if (versions.length !== 1 || !UUID.test(versions[0])) {
    throw new Error("Wrangler did not report exactly one valid Current Version ID");
  }
  return versions[0];
}

/** A deployment must serve precisely the new version at 100% traffic. */
export function selectDeployment(deployments, versionId, startedAt) {
  if (!UUID.test(versionId) || !Array.isArray(deployments)) {
    throw new Error("Invalid Workers deployment response");
  }
  const matches = deployments.filter((deployment) =>
    Array.isArray(deployment.versions) &&
    deployment.versions.some((version) => version.version_id === versionId)
  );
  if (matches.length === 0) {
    return null;
  }
  if (matches.length !== 1) {
    throw new Error("More than one deployment references the new Worker version");
  }
  const deployment = matches[0];
  if (
    !UUID.test(deployment.id) ||
    !Number.isFinite(Date.parse(deployment.created_on)) ||
    Date.parse(deployment.created_on) < startedAt ||
    deployment.versions.length !== 1 ||
    deployment.versions[0].percentage !== 100
  ) {
    throw new Error("The matched deployment is ambiguous or not at 100% traffic");
  }
  return { deploymentId: deployment.id, deployedAt: deployment.created_on };
}
