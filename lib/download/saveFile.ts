import { fetchDecryptedStream, type DecryptedFile } from "./decrypt";
import { FileGoneError } from "./errors";

// File System Access API の最小型定義。標準libに未収載の環境(Safari/Firefox
// など)でも型エラーにならないよう、必要なメンバーだけをここで宣言する。
type MinimalWritableFileStream = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};

type MinimalFileSystemFileHandle = {
  createWritable: () => Promise<MinimalWritableFileStream>;
};

type MinimalDirectoryHandle = {
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<MinimalFileSystemFileHandle>;
};

type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<MinimalFileSystemFileHandle>;

type ShowDirectoryPicker = (options?: {
  mode?: "read" | "readwrite";
}) => Promise<MinimalDirectoryHandle>;

export function getShowSaveFilePicker(): ShowSaveFilePicker | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (
    window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }
  ).showSaveFilePicker;

  return typeof candidate === "function" ? candidate : null;
}

export function getShowDirectoryPicker(): ShowDirectoryPicker | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (
    window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }
  ).showDirectoryPicker;

  return typeof candidate === "function" ? candidate : null;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// ReadableStream を WritableFileStream へ逐次コピーする。失敗時は読み取り側を
// 打ち切り、書き込み側を abort してから元の例外を投げ直す。
async function pipeStreamToWritable(
  stream: ReadableStream<Uint8Array>,
  writable: MinimalWritableFileStream
): Promise<void> {
  const reader = stream.getReader();

  try {
    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      await writable.write(value);
    }

    await writable.close();
  } catch (err) {
    reader.releaseLock();
    await stream.cancel().catch(() => {});
    await writable.abort(err).catch(() => {});
    throw err;
  }
}

// Blobを組み立てて <a download> クリックで保存する。ファイル全体をメモリ上の
// Blobに保持するため、showSaveFilePicker が使えない環境向けのフォールバック。
// 復号済みチャンクの配列をそのままBlobへ渡すことで、ファイルサイズ分の連続領域
// を別途確保する(旧実装の combined)コピーは避ける。
export function triggerBlobDownload(
  parts: Uint8Array[],
  filename: string
): void {
  const blob = new Blob(parts as BlobPart[]);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // 大きなBlobだと、クリック直後の同期的なrevokeでブラウザがダウンロードを
  // 開始する前にURLが失効してしまうことがあるため、少し遅らせて解放する。
  const timer = setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // Node(テスト等)でこのタイマーがイベントループを占有し続けないようにする。
  (timer as unknown as { unref?: () => void }).unref?.();
}

async function collectParts(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];

  try {
    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      parts.push(value);
    }
  } catch (err) {
    reader.releaseLock();
    await stream.cancel().catch(() => {});
    throw err;
  }

  return parts;
}

async function saveViaBlob(
  file: DecryptedFile,
  key: CryptoKey,
  filename: string
): Promise<void> {
  const stream = await fetchDecryptedStream(file, key);
  const parts = await collectParts(stream);

  triggerBlobDownload(parts, filename);
}

async function saveToHandle(
  handle: MinimalFileSystemFileHandle,
  file: DecryptedFile,
  key: CryptoKey
): Promise<void> {
  // 保存先ハンドルより先にストリームを取得する。404(FileGoneError)などで
  // ここが失敗した場合、書き込み用ファイルを一切作らずに終わる。
  const stream = await fetchDecryptedStream(file, key);
  const writable = await handle.createWritable();

  await pipeStreamToWritable(stream, writable);
}

export type DirectorySaveEntry = {
  name: string;
  file: DecryptedFile;
};

// 選ばれたディレクトリへ、複数の復号済みファイルを1つずつストリーミング保存
// する。ZIP をやめて個別保存へフォールバックする経路(合計/単体が zip64 の
// 限界を超える場合)で使う。ファイル全体をメモリに載せない。
// 途中で 404(FileGoneError)になったファイルはスキップし、その ID を返す。
export async function saveDecryptedFilesToDirectory(
  dir: MinimalDirectoryHandle,
  entries: DirectorySaveEntry[],
  key: CryptoKey
): Promise<{ goneFileIds: string[]; savedCount: number }> {
  const goneFileIds: string[] = [];
  let savedCount = 0;

  for (const entry of entries) {
    let stream: ReadableStream<Uint8Array>;

    try {
      // 保存先ファイルを作る前にストリームを取得する(404 ならファイルを
      // 一切作らずにスキップできる)。
      stream = await fetchDecryptedStream(entry.file, key);
    } catch (err) {
      if (err instanceof FileGoneError) {
        goneFileIds.push(entry.file.id);
        continue;
      }
      throw err;
    }

    const handle = await dir.getFileHandle(entry.name, { create: true });
    const writable = await handle.createWritable();

    await pipeStreamToWritable(stream, writable);
    savedCount++;
  }

  return { goneFileIds, savedCount };
}

export type SaveResult = {
  // ユーザーが保存ダイアログをキャンセルした場合は false。
  saved: boolean;
};

// 復号済みファイルを保存する。showSaveFilePicker が使える環境(Chromium系)では
// 保存先を選ばせてディスクへ逐次書き込み、ファイル全体をメモリに載せない。
// それ以外の環境では Blob フォールバックで保存する。
//
// showSaveFilePicker はユーザー操作(クリック)直後の transient activation を
// 要求するため、fetch より先に呼ぶこと。
export async function saveDecryptedFile(
  file: DecryptedFile,
  key: CryptoKey,
  filename: string
): Promise<SaveResult> {
  const showSaveFilePicker = getShowSaveFilePicker();

  if (!showSaveFilePicker) {
    await saveViaBlob(file, key, filename);
    return { saved: true };
  }

  let handle: MinimalFileSystemFileHandle;

  try {
    handle = await showSaveFilePicker({ suggestedName: filename });
  } catch (err) {
    if (isAbortError(err)) {
      return { saved: false };
    }

    // ピッカーを開けない環境(iframe の権限ポリシー等)。Blob で保存を試みる。
    await saveViaBlob(file, key, filename);
    return { saved: true };
  }

  await saveToHandle(handle, file, key);
  return { saved: true };
}
