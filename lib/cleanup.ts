import { budgetCleanup, CleanupWorkLimitError } from "./storage/cleanupBudget";
import { isMissingMultipartUpload } from "./storage/r2Errors";

type ExpiredShare = {
  id: string;
};

type FileStorageKey = {
  id: string;
  storage_key: string;
};

type UploadSession = {
  id: string;
  storage_key: string;
  upload_id: string;
};

const R2_DELETE_BATCH_SIZE = 1_000;
export class ShareDeletionDeferredError extends Error {}
export class StorageReconciliationError extends Error {}

// Unknown failures must keep D1 tracking for the next run. Only NoSuchUpload
// is equivalent to a completed/aborted/missing multipart upload.
async function abortMultipartUpload(env: CloudflareEnv, storageKey: string, uploadId: string): Promise<void> {
  try {
    await env.FILES_BUCKET.resumeMultipartUpload(storageKey, uploadId).abort();
  } catch (error) {
    if (!isMissingMultipartUpload(error)) throw error;
  }
  // A completed object may exist after complete() succeeded but D1 failed.
  // Keep its existing tracking row; orphan removal requires human review.
  const object = await env.FILES_BUCKET.head(storageKey);
  if (object) {
    const file = await env.DB.prepare(`SELECT id FROM files WHERE storage_key = ? LIMIT 1`).bind(storageKey).first();
    if (!file) throw new StorageReconciliationError("Completed upload requires reconciliation");
  }
}

const SHARE_FILE_BATCH_SIZE = 1_000;
const SHARE_UPLOAD_BATCH_SIZE = 20;

// Delete one bounded snapshot. Remaining/concurrently added records produce
// ShareDeletionDeferredError; callers must explicitly retry. Missing shares are
// safe no-ops. Never cascade away R2 objects that were not inspected.
// 期限切れ共有の一括掃除(cleanupExpiredShares)と管理画面からの
// テイクダウン操作の両方がこのロジックを共有する。
export async function deleteShare(
  env: CloudflareEnv,
  shareId: string
): Promise<void> {
  const files = await env.DB.prepare(`SELECT id, storage_key FROM files WHERE share_id = ? LIMIT ?`)
    .bind(shareId, SHARE_FILE_BATCH_SIZE).all<FileStorageKey>();
  const uploads = await env.DB.prepare(`SELECT id, storage_key, upload_id FROM uploads WHERE share_id = ? LIMIT ?`)
    .bind(shareId, SHARE_UPLOAD_BATCH_SIZE).all<UploadSession>();
  const fileIds = (files.results ?? []).map(file => file.id);
  const storageKeys = [...new Set((files.results ?? []).map(file => file.storage_key))];
  const uploadIds = (uploads.results ?? []).map(upload => upload.id);

  if (storageKeys.length) {
    const otherReference = await env.DB.prepare(`SELECT id FROM files WHERE storage_key IN (SELECT value FROM json_each(?))
      AND id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`)
      .bind(JSON.stringify(storageKeys), JSON.stringify(fileIds)).first();
    if (otherReference) throw new StorageReconciliationError("Storage key has uninspected file references");
  }
  // Do not remove registered files if an upload cannot safely be retired.
  for (const upload of uploads.results ?? []) {
    await abortMultipartUpload(env, upload.storage_key, upload.upload_id);
  }
  for (let start = 0; start < storageKeys.length; start += R2_DELETE_BATCH_SIZE) {
    await env.FILES_BUCKET.delete(storageKeys.slice(start, start + R2_DELETE_BATCH_SIZE));
  }

  // Delete only the rows actually inspected above. A concurrent completion or
  // addition must not be cascaded away together with an uninspected R2 object.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM files WHERE share_id = ? AND id IN (SELECT value FROM json_each(?))`)
      .bind(shareId, JSON.stringify(fileIds)),
    env.DB.prepare(`DELETE FROM upload_parts WHERE upload_session_id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(uploadIds)),
    env.DB.prepare(`DELETE FROM uploads WHERE share_id = ? AND id IN (SELECT value FROM json_each(?))`)
      .bind(shareId, JSON.stringify(uploadIds)),
    env.DB.prepare(`DELETE FROM shares WHERE id = ? AND NOT EXISTS (SELECT 1 FROM files WHERE share_id = ?)
      AND NOT EXISTS (SELECT 1 FROM uploads WHERE share_id = ?)`)
      .bind(shareId, shareId, shareId),
  ]);
  const remaining = await env.DB.prepare(`SELECT id FROM shares WHERE id = ?`).bind(shareId).first();
  if (remaining) throw new ShareDeletionDeferredError("Share deletion has remaining or concurrent records; retry required");
}

// Bound candidate count and per-share R2/D1 work. These are application work
// limits, not assertions about Cloudflare plan-specific quotas. Remaining rows
// stay eligible for the next existing six-hour run.
const CLEANUP_QUERY_LIMIT = 20;
const CLEANUP_MAX_BATCHES = 3;

export type CleanupBatchOptions = {
  // 1クエリで取得する件数(テスト用に上書き可能)。
  queryLimit?: number;
  // 1回の実行で回すバッチ数の上限(テスト用に上書き可能)。
  maxBatches?: number;
  // Read D1 candidates only; never call R2 or mutate D1.
  dryRun?: boolean;
  // Prepared SQL statements + R2 calls; remaining work stays eligible.
  workLimit?: number;
};

export type CleanupResult = {
  // 削除に成功した件数。
  processed: number;
  dryRun?: true;
  candidates?: number;
  workLimitReached?: true;
  // 削除に失敗し、次回以降の実行へ持ち越した件数。
  failed: number;
  // バッチ数上限に達しており、未処理が残っている可能性がある。
  reachedBatchLimit: boolean;
};

// 「対象をLIMIT件ずつ取得 → 1件ずつ処理」をバッチで繰り返す共通ロジック。
//
// - 1件の失敗がその回の実行全体を止めないよう、各件を try/catch し、失敗は
//   ログに残して次へ進む。
// - 削除に失敗した行は抽出条件を満たしたまま残るため、同じ実行内で再取得して
//   無限ループにならないよう、失敗したIDを覚えて以降のバッチから除外する。
//   さらに、恒久的に失敗する行が queryLimit 件以上あってもその後ろの正常な
//   行が永久に掃除されないよう、取得件数を「queryLimit + これまでの失敗数」に
//   広げ、毎バッチ必ず queryLimit 件の新しい候補を見に行く。
// - バッチ数の上限で1回の実行あたりのサブリクエスト量を抑える。消化しきれ
//   なかった場合は reachedBatchLimit を立てて次回以降に委ねる。
async function runCleanupBatches<Row extends { id: string }>(
  options: CleanupBatchOptions,
  fetchBatch: (limit: number) => Promise<Row[]>,
  handle: (row: Row) => Promise<void>,
  onError: (row: Row, error: unknown) => void
): Promise<CleanupResult> {
  const queryLimit = options.queryLimit ?? CLEANUP_QUERY_LIMIT;
  const maxBatches = options.maxBatches ?? CLEANUP_MAX_BATCHES;

  if (!Number.isSafeInteger(queryLimit) || queryLimit < 1 || queryLimit > 100 || !Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 10) throw new Error("Invalid cleanup batch limits");
  const previewedIds = new Set<string>();
  let processed = 0;
  const failedIds = new Set<string>();
  let reachedBatchLimit = false;
  let workLimitReached = false;

  batches: for (let batch = 0; batch < maxBatches; batch++) {
    const limit = queryLimit + failedIds.size + previewedIds.size;
    let fetched: Row[];
    try { fetched = await fetchBatch(limit); }
    catch (error) {
      if (!(error instanceof CleanupWorkLimitError)) throw error;
      reachedBatchLimit = true; workLimitReached = true; break;
    }
    const rows = fetched.filter((row) => !failedIds.has(row.id) && !previewedIds.has(row.id));

    // 新しく処理できる候補がもう無い。
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (options.dryRun) { previewedIds.add(row.id); continue; }
      try {
        await handle(row);
        processed++;
      } catch (error) {
        if (error instanceof CleanupWorkLimitError) {
          reachedBatchLimit = true; workLimitReached = true; break batches;
        }
        failedIds.add(row.id);
        onError(row, error);
      }
    }

    // 取得件数が上限未満 = 対象を全部取り切った。次のバッチで新しく処理
    // できるものはもう無い。
    if (fetched.length < limit) {
      break;
    }

    // 最後のバッチを満杯で使い切った = まだ未処理が残っている可能性が高い。
    if (batch === maxBatches - 1) {
      reachedBatchLimit = true;
    }
  }

  return {
    processed,
    ...(workLimitReached ? { workLimitReached: true as const } : {}),
    ...(options.dryRun ? { dryRun: true as const, candidates: previewedIds.size } : {}),
    failed: failedIds.size,
    reachedBatchLimit,
  };
}

// 期限切れ共有をR2オブジェクト・D1レコードごと削除する。
export async function cleanupExpiredShares(
  env: CloudflareEnv,
  options: CleanupBatchOptions = {}
): Promise<CleanupResult> {
  env = budgetCleanup(env, options.workLimit);
  return runCleanupBatches<ExpiredShare>(
    options,
    async (limit) => {
      const result = await env.DB.prepare(
        `SELECT id FROM shares WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?`
      )
        .bind(new Date().toISOString(), limit)
        .all<ExpiredShare>();

      return result.results ?? [];
    },
    (share) => deleteShare(env, share.id),
    () => {
      console.error(
        "cleanupExpiredShares: deletion deferred; tracking retained"
      );
    }
  );
}

// アップロード中の通信断・タブを閉じるなどでクライアントが完了処理
// (/api/upload/complete)まで辿り着けなかったアップロードセッションは、
// 共有自体はまだ有効期限内でも放置されたままR2にゴミが残り続ける。
// これを共有の有効期限とは無関係に、セッション自体の古さで掃除する。
const STALE_UPLOAD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24時間

async function deleteStaleUpload(
  env: CloudflareEnv,
  upload: UploadSession
): Promise<void> {
  await abortMultipartUpload(env, upload.storage_key, upload.upload_id);

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM upload_parts WHERE upload_session_id = ?`
    ).bind(upload.id),
    env.DB.prepare(`DELETE FROM uploads WHERE id = ?`).bind(upload.id),
  ]);
}

export async function cleanupStaleUploads(
  env: CloudflareEnv,
  options: CleanupBatchOptions = {}
): Promise<CleanupResult> {
  env = budgetCleanup(env, options.workLimit);
  return runCleanupBatches<UploadSession>(
    options,
    async (limit) => {
      const staleBefore = new Date(
        Date.now() - STALE_UPLOAD_THRESHOLD_MS
      ).toISOString();

      const result = await env.DB.prepare(
        `SELECT id, storage_key, upload_id FROM uploads WHERE created_at <= ? ORDER BY created_at ASC LIMIT ?`
      )
        .bind(staleBefore, limit)
        .all<UploadSession>();

      return result.results ?? [];
    },
    (upload) => deleteStaleUpload(env, upload),
    () => {
      console.error(
        "cleanupStaleUploads: deletion deferred; tracking retained"
      );
    }
  );
}

export type ScheduledCleanupSummary = {
  expiredShares: CleanupResult | null;
  staleUploads: CleanupResult | null;
};

// Cron(custom-worker.ts の scheduled ハンドラ)から呼ばれるオーケストレータ。
// 片方の掃除が(想定外の理由で)throw しても、もう片方は必ず実行する。
export async function runScheduledCleanup(
  env: CloudflareEnv,
  options: Pick<CleanupBatchOptions, "workLimit"> = {},
): Promise<ScheduledCleanupSummary> {
  // Share one ceiling across both phases. Each phase also has its own ceiling.
  env = budgetCleanup(env, options.workLimit);
  const summary: ScheduledCleanupSummary = {
    expiredShares: null,
    staleUploads: null,
  };

  try {
    summary.expiredShares = await cleanupExpiredShares(env);
  } catch {
    console.error("runScheduledCleanup: expired-share scan failed");
  }

  try {
    summary.staleUploads = await cleanupStaleUploads(env);
  } catch {
    console.error("runScheduledCleanup: stale-upload scan failed");
  }

  // 削除失敗の持ち越しやバッチ上限による未処理は、放置すると期限切れ
  // ファイルが残り続けること(issue #63)に直結するため warning で目立たせる
  // (Cloudflare 側で Workers Logs / Logpush / Tail Consumer を設定していれば
  // ここで気づける)。
  const hasBacklog =
    summary.expiredShares === null ||
    summary.staleUploads === null ||
    summary.expiredShares.failed > 0 ||
    summary.expiredShares.reachedBatchLimit ||
    summary.staleUploads.failed > 0 ||
    summary.staleUploads.reachedBatchLimit;

  const log = hasBacklog ? console.warn : console.log;
  log("runScheduledCleanup: done", JSON.stringify(summary));

  return summary;
}
