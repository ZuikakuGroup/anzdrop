export const HEALTH_TIMEOUT_MS = 3_000;

async function probe(run: () => Promise<unknown>): Promise<"ok" | "error" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run).then(() => "ok" as const, () => "error" as const),
      new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), HEALTH_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Read-only: no user rows or file metadata are read and no probe objects are written.
// A missing reserved object is a successful R2 request.
export async function checkDependencies(env: Pick<CloudflareEnv, "DB" | "FILES_BUCKET">) {
  const [d1, r2] = await Promise.all([
    probe(async () => {
      const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      if (result?.ok !== 1) throw new Error("probe failed");
    }),
    probe(() => env.FILES_BUCKET.head("__anzdrop_readiness_probe__")),
  ]);
  return { success: d1 === "ok" && r2 === "ok", checks: { d1, r2 } };
}
