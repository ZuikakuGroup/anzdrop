import type { DecryptedFile } from "./decrypt";

// 現在表示しているすべてのファイルについて、保存の開始に成功したかを返す。
// 空の一覧はダウンロード完了とは扱わない。
export function hasDownloadedAllFiles(
  files: DecryptedFile[],
  downloadedFileIds: ReadonlySet<string>,
  unavailableFileIds: ReadonlySet<string> = new Set()
): boolean {
  return (
    files.length > 0 && files.every((file) => downloadedFileIds.has(file.id))
    && unavailableFileIds.size === 0
  );
}
