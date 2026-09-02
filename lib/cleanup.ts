type ExpiredShare = {
  id: string;
};

type FileStorageKey = {
  storage_key: string;
};

type UploadSession = {
  id: string;
  storage_key: string;
  upload_id: string;
};

const R2_DELETE_BATCH_SIZE = 1_000;

// R2の未完了マルチパートアップロードは、完了/中断しない限りパートが課金対象の
// ストレージとして残り続けるため、中断してから対応するDB行を消す。
// abortは「既に完了済み/既に中断済み/そもそも存在しない」でも失敗しうるが、
// その場合もDB側の掃除は継続してよい(R2側にゴミが残っていないということなので)。
async function abortMultipartUpload(
  env: CloudflareEnv,
  storageKey: string,
  uploadId: string
): Promise<void> {
  try {
    await env.FILES_BUCKET.resumeMultipartUpload(
      storageKey,
      uploadId
    ).abort();
  } catch {
    // 既に完了/中断済みなどで失敗しても掃除自体は継続する
  }
}

// 指定した共有1件をR2/D1から完全に削除する。共有が既に存在しない場合も
// (SELECT/DELETEが単に0件を返すだけなので)エラーにならず安全に呼べる。
// 期限切れ共有の一括掃除(cleanupExpiredShares)と管理画面からの
// テイクダウン操作の両方がこのロジックを共有する。
export async function deleteShare(
  env: CloudflareEnv,
  shareId: string
): Promise<void> {
  const files = await env.DB.prepare(
    `SELECT storage_key FROM files WHERE share_id = ?`
  )
    .bind(shareId)
    .all<FileStorageKey>();

  const storageKeys = (files.results ?? []).map((file) => file.storage_key);

  // R2 の一括 delete は1回に最大1000キーまで。各バッチを完了させてから
  // 次へ進み、すべての R2 削除が成功した後にだけ D1 行を削除する。
  for (let start = 0; start < storageKeys.length; start += R2_DELETE_BATCH_SIZE) {
    await env.FILES_BUCKET.delete(
      storageKeys.slice(start, start + R2_DELETE_BATCH_SIZE)
    );
  }

  // 完了しないまま共有が削除される場合も、R2に未完了マルチパートアップロード
  // として残るため中断しておく。
  const uploads = await env.DB.prepare(
    `SELECT id, storage_key, upload_id FROM uploads WHERE share_id = ?`
  )
    .bind(shareId)
    .all<UploadSession>();

  for (const upload of uploads.results ?? []) {
    await abortMultipartUpload(env, upload.storage_key, upload.upload_id);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM files WHERE share_id = ?`).bind(shareId),
    env.DB.prepare(
      `DELETE FROM upload_parts WHERE upload_session_id IN (
        SELECT id FROM uploads WHERE share_id = ?
      )`
    ).bind(shareId),
    env.DB.prepare(`DELETE FROM uploads WHERE share_id = ?`).bind(shareId),
    env.DB.prepare(`DELETE FROM shares WHERE id = ?`).bind(shareId),
  ]);
}

// 1回のCron実行で処理する上限。バックログが大きくても Workers のサブリクエスト
// 上限(1回の呼び出しあたり1000)内で確実に一部を消化し、残りは次回以降の実行で
// 片付ける(GitHub issue #63)。
//
// 1件の `deleteShare` は SELECT×2 + R2 delete×(ファイル数/1000の切り上げ) +
// abort×(未完了アップロード数) + D1 batch で、通常は概ね5〜10サブリクエスト。期限切れ共有と
// 放置アップロードの掃除は同じ scheduled 呼び出し内で連続実行されるため、
// 両者あわせても上限に収まるよう控えめに設定する(6時間ごとに実行されるので
// 1回で消化しきれなくても実用上問題ない)。
const CLEANUP_QUERY_LIMIT = 20;
const CLEANUP_MAX_BATCHES = 3;

export type CleanupBatchOptions = {
  // 1クエリで取得する件数(テスト用に上書き可能)。
  queryLimit?: number;
  // 1回の実行で回すバッチ数の上限(テスト用に上書き可能)。
  maxBatches?: number;
};

export type CleanupResult = {
  // 削除に成功した件数。
  processed: number;
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

  let processed = 0;
  const failedIds = new Set<string>();
  let reachedBatchLimit = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const limit = queryLimit + failedIds.size;
    const fetched = await fetchBatch(limit);
    const rows = fetched.filter((row) => !failedIds.has(row.id));

    // 新しく処理できる候補がもう無い。
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      try {
        await handle(row);
        processed++;
      } catch (error) {
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
    failed: failedIds.size,
    reachedBatchLimit,
  };
}

// 期限切れ共有をR2オブジェクト・D1レコードごと削除する。
export async function cleanupExpiredShares(
  env: CloudflareEnv,
  options: CleanupBatchOptions = {}
): Promise<CleanupResult> {
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
    (share, error) => {
      console.error(
        `cleanupExpiredShares: failed to delete share ${share.id}:`,
        error
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
    (upload, error) => {
      console.error(
        `cleanupStaleUploads: failed to delete upload session ${upload.id}:`,
        error
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
  env: CloudflareEnv
): Promise<ScheduledCleanupSummary> {
  const summary: ScheduledCleanupSummary = {
    expiredShares: null,
    staleUploads: null,
  };

  try {
    summary.expiredShares = await cleanupExpiredShares(env);
  } catch (error) {
    console.error("runScheduledCleanup: cleanupExpiredShares threw:", error);
  }

  try {
    summary.staleUploads = await cleanupStaleUploads(env);
  } catch (error) {
    console.error("runScheduledCleanup: cleanupStaleUploads threw:", error);
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
