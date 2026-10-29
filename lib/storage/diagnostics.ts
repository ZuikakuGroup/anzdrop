type StorageEnv = Pick<CloudflareEnv, "DB" | "FILES_BUCKET">;
export type StorageDiagnosticOptions = {
  limit?: number;
  afterFileId?: string;
  objectCursor?: string;
  summary?: boolean;
  scan?: "files" | "objects" | "both";
  now?: Date;
};

// Deliberately no write/abort/delete operations. Results are a live sample,
// not a transactionally consistent snapshot or permission to remove objects.
export async function diagnoseStorage(env: StorageEnv, options: StorageDiagnosticOptions = {}) {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw new Error("Invalid diagnostic limit");
  const now = (options.now ?? new Date()).toISOString();
  const staleBefore = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const firstPage = !options.afterFileId && !options.objectCursor;
  const includeSummary = options.summary ?? firstPage;
  const scanFiles = options.scan !== "objects", scanObjects = options.scan !== "files";
  const summary = includeSummary ? await env.DB.prepare(`
    SELECT COUNT(*) AS registeredFiles, COALESCE(SUM(files.size), 0) AS registeredPlaintextBytes,
      COALESCE(SUM(CASE WHEN shares.expires_at <= ? THEN 1 ELSE 0 END), 0) AS expiredFiles,
      COALESCE(SUM(CASE WHEN shares.id IS NULL THEN 1 ELSE 0 END), 0) AS filesWithoutShare,
      COALESCE(SUM(CASE WHEN files.max_downloads IS NOT NULL AND files.download_count >= files.max_downloads THEN 1 ELSE 0 END), 0) AS exhaustedFiles,
      (SELECT COUNT(*) FROM shares) AS shares,
      (SELECT COUNT(*) FROM shares WHERE expires_at <= ?) AS expiredShares,
      (SELECT COUNT(*) FROM uploads) AS uploadSessions,
      (SELECT COUNT(*) FROM uploads WHERE created_at <= ?) AS staleUploads
    FROM files LEFT JOIN shares ON shares.id = files.share_id
  `).bind(now, now, staleBefore).first<{
    registeredFiles: number; registeredPlaintextBytes: number; expiredFiles: number;
    filesWithoutShare: number; exhaustedFiles: number; shares: number; expiredShares: number;
    uploadSessions: number; staleUploads: number;
  }>() : null;

  const expired = firstPage ? await env.DB.prepare(`SELECT id FROM shares WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?`)
    .bind(now, limit + 1).all<{ id: string }>() : { results: [] };
  const stale = firstPage ? await env.DB.prepare(`SELECT id FROM uploads WHERE created_at <= ? ORDER BY created_at, id LIMIT ?`)
    .bind(staleBefore, limit + 1).all<{ id: string }>() : { results: [] };
  const files = scanFiles ? await env.DB.prepare(`SELECT id, storage_key FROM files WHERE id > ? ORDER BY id LIMIT ?`)
    .bind(options.afterFileId ?? "", limit + 1).all<{ id: string; storage_key: string }>() : { results: [] };
  const page = files.results.slice(0, limit);
  const missingFileIds: string[] = [], headFailureFileIds: string[] = [];
  // Keep concurrent R2 operations below the per-invocation connection limit.
  for (let start = 0; start < page.length; start += 5) {
    await Promise.all(page.slice(start, start + 5).map(async file => {
      try { if (!await env.FILES_BUCKET.head(file.storage_key)) missingFileIds.push(file.id); }
      catch { headFailureFileIds.push(file.id); }
    }));
  }
  const listed = scanObjects ? await env.FILES_BUCKET.list({ limit, ...(options.objectCursor ? { cursor: options.objectCursor } : {}) })
    : { objects: [] as R2Object[], truncated: false as const };
  const keys = listed.objects.map(object => object.key);
  const references = keys.length ? await env.DB.prepare(`
    SELECT storage_key, 'file' AS kind FROM files WHERE storage_key IN (SELECT value FROM json_each(?))
    UNION ALL
    SELECT storage_key, 'upload' AS kind FROM uploads WHERE storage_key IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(keys), JSON.stringify(keys)).all<{ storage_key: string; kind: "file" | "upload" }>() : { results: [] };
  const registered = new Set(references.results.filter(row => row.kind === "file").map(row => row.storage_key));
  const uploading = new Set(references.results.filter(row => row.kind === "upload").map(row => row.storage_key));

  return {
    dryRun: true as const,
    observedAt: now,
    snapshotConsistent: false,
    summary,
    deletionFailureHistoryAvailable: false,
    candidates: firstPage ? {
      expiredShareIds: expired.results.slice(0, limit).map(row => row.id),
      moreExpiredShares: expired.results.length > limit,
      staleUploadIds: stale.results.slice(0, limit).map(row => row.id),
      moreStaleUploads: stale.results.length > limit,
    } : null,
    files: {
      scanned: scanFiles,
      inspected: page.length, missingFileIds: missingFileIds.sort(), headFailureFileIds: headFailureFileIds.sort(),
      nextAfterFileId: files.results.length > limit ? page.at(-1)!.id : null,
    },
    objects: {
      scanned: scanObjects,
      listed: listed.objects.length,
      listedCiphertextBytes: listed.objects.reduce((sum, object) => sum + object.size, 0),
      suspectedOrphanKeys: keys.filter(key => !registered.has(key) && !uploading.has(key)),
      multipleFileReferenceKeys: keys.filter(key => references.results.filter(row => row.kind === "file" && row.storage_key === key).length > 1),
      completedUploadKeys: keys.filter(key => !registered.has(key) && uploading.has(key)),
      nextCursor: listed.truncated ? listed.cursor : null,
    },
  };
}
