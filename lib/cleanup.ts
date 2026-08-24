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

  for (const file of files.results ?? []) {
    await env.FILES_BUCKET.delete(file.storage_key);
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

export async function cleanupExpiredShares(
  env: CloudflareEnv
): Promise<void> {
  const now = new Date().toISOString();

  const expiredShares = await env.DB.prepare(
    `SELECT id FROM shares WHERE expires_at <= ?`
  )
    .bind(now)
    .all<ExpiredShare>();

  for (const share of expiredShares.results ?? []) {
    await deleteShare(env, share.id);
  }
}

// アップロード中の通信断・タブを閉じるなどでクライアントが完了処理
// (/api/upload/complete)まで辿り着けなかったアップロードセッションは、
// 共有自体はまだ有効期限内でも放置されたままR2にゴミが残り続ける。
// これを共有の有効期限とは無関係に、セッション自体の古さで掃除する。
const STALE_UPLOAD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24時間

export async function cleanupStaleUploads(
  env: CloudflareEnv
): Promise<void> {
  const staleBefore = new Date(
    Date.now() - STALE_UPLOAD_THRESHOLD_MS
  ).toISOString();

  const staleUploads = await env.DB.prepare(
    `SELECT id, storage_key, upload_id FROM uploads WHERE created_at <= ?`
  )
    .bind(staleBefore)
    .all<UploadSession>();

  for (const upload of staleUploads.results ?? []) {
    await abortMultipartUpload(
      env,
      upload.storage_key,
      upload.upload_id
    );

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM upload_parts WHERE upload_session_id = ?`
      ).bind(upload.id),
      env.DB.prepare(`DELETE FROM uploads WHERE id = ?`).bind(
        upload.id
      ),
    ]);
  }
}
