export class CleanupWorkLimitError extends Error {}

// Count prepared SQL statements and R2 operations, including statements in a
// D1 batch. This is an application ceiling, not a substitute for plan quotas.
export function budgetCleanup(env: CloudflareEnv, limit = 900): CloudflareEnv {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 900) throw new Error("Invalid cleanup work limit");
  let remaining = limit;
  const consume = () => {
    if (remaining === 0) throw new CleanupWorkLimitError("Cleanup work limit reached");
    remaining--;
  };
  const db = new Proxy(env.DB, { get(target, property) {
    if (property === "prepare") return (sql: string) => { consume(); return target.prepare(sql); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const bucket = new Proxy(env.FILES_BUCKET, { get(target, property) {
    if (property === "resumeMultipartUpload") return (key: string, uploadId: string) => {
      const upload = target.resumeMultipartUpload(key, uploadId);
      return new Proxy(upload, { get(multipart, method) {
        if (method === "abort") return () => { consume(); return multipart.abort(); };
        const value = Reflect.get(multipart, method);
        return typeof value === "function" ? value.bind(multipart) : value;
      } });
    };
    if (property === "delete") return (keys: string | string[]) => { consume(); return target.delete(keys); };
    if (property === "head") return (key: string) => { consume(); return target.head(key); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { ...env, DB: db, FILES_BUCKET: bucket };
}
