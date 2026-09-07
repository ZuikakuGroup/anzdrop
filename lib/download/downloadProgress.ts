import type { DecryptedFile } from "./decrypt";

export const SEND_CTA_OPEN_DELAY_MS = 1_500;

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

// CTAモーダルの表示と表示計測はこの同じ条件に従う。
export function shouldShowSendCta(
  files: DecryptedFile[],
  downloadedFileIds: ReadonlySet<string>,
  unavailableFileIds: ReadonlySet<string>,
  isSendCtaDisabled: boolean
): boolean {
  return (
    !isSendCtaDisabled &&
    hasDownloadedAllFiles(files, downloadedFileIds, unavailableFileIds)
  );
}

// ダウンロード完了の直後にブラウザの保存UIと重ならないよう、CTAは少し待ってから表示する。
export function scheduleSendCtaOpen(onOpen: () => void): () => void {
  const timer = setTimeout(onOpen, SEND_CTA_OPEN_DELAY_MS);

  return () => clearTimeout(timer);
}
