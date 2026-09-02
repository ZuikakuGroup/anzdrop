import { fetchAndDecrypt, fetchDecryptedStream, type DecryptedFile } from "./decrypt";
import { FileGoneError, FriendlyError, FILE_GONE_ERROR } from "./errors";
import {
  getShowDirectoryPicker,
  getShowSaveFilePicker,
  isAbortError,
  saveDecryptedFilesToDirectory,
  triggerBlobDownload,
} from "./saveFile";
import {
  canStreamFilesAsZip,
  streamFilesAsZip,
  withDuplicateSuffix,
  zipFiles,
  type ZipEntrySource,
} from "./zipDownload";

// File System Access API が使えない環境(Firefox/Safari)でメモリ内 ZIP を
// 許容する合計サイズの上限。復号済み平文 + ZIP 出力をまとめてメモリに載せる
// ため保守的に。これを超える場合は「Chrome/Edge を使うか個別にダウンロード」
// を案内する(真のストリーミングは Service Worker 対応で別途。issue #61)。
export const IN_MEMORY_ZIP_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB

export type DownloadAllResult = {
  // ユーザーが保存ダイアログ/フォルダ選択をキャンセルした。
  cancelled: boolean;
  // 404 だったため一覧から外すべきファイルの ID。
  goneFileIds: string[];
  // 実際にダウンロード(保存)を開始したか。
  started: boolean;
};

export type DownloadAllOptions = {
  // 404 で取得できなかったファイルを検知するたびに呼ばれる(一覧からの
  // 除去に使う)。streaming ZIP のように途中で中断した場合でも、ここまでに
  // 検知したぶんは通知される。
  onFileGone?: (fileId: string) => void;
};

type NamedFile = { file: DecryptedFile; name: string };

function assignZipNames(files: DecryptedFile[]): NamedFile[] {
  const usedNames = new Map<string, number>();

  return files.map((file) => {
    const count = usedNames.get(file.name) ?? 0;
    usedNames.set(file.name, count + 1);
    return { file, name: withDuplicateSuffix(file.name, count) };
  });
}

// 共有内の全ファイルを一括ダウンロードする。環境と合計サイズに応じて経路を選ぶ:
//
// 1. Chromium 系(showSaveFilePicker)かつ zip64 不要 → ストリーミング ZIP を
//    選んだ .zip ファイルへ直接書き出す(1ファイル分も ZIP 全体もメモリに
//    載せない。GitHub issue #59)。
// 2. Chromium 系で 4GiB を超え ZIP にできない(showDirectoryPicker) →
//    フォルダを選んで1ファイルずつストリーミング保存。
// 3. File System Access API 非対応 → 合計サイズが上限内ならメモリ内 ZIP、
//    超える場合は案内メッセージで中断。
export async function downloadAllFiles(
  files: DecryptedFile[],
  key: CryptoKey,
  options: DownloadAllOptions = {}
): Promise<DownloadAllResult> {
  const named = assignZipNames(files);
  const sizes = files.map((file) => file.size);
  const goneFileIds: string[] = [];

  const markGone = (fileId: string): void => {
    if (!goneFileIds.includes(fileId)) {
      goneFileIds.push(fileId);
      options.onFileGone?.(fileId);
    }
  };

  const savePicker = getShowSaveFilePicker();
  const directoryPicker = getShowDirectoryPicker();

  // --- 1. ストリーミング ZIP をディスクへ ---
  if (savePicker && canStreamFilesAsZip(sizes)) {
    let handle;
    try {
      handle = await savePicker({ suggestedName: "anzdrop.zip" });
    } catch (err) {
      if (isAbortError(err)) {
        return { cancelled: true, goneFileIds, started: false };
      }
      throw err;
    }

    const writable = await handle.createWritable();
    const entries: ZipEntrySource[] = named.map(({ file, name }) => ({
      name,
      open: () =>
        fetchDecryptedStream(file, key).catch((err) => {
          if (err instanceof FileGoneError) {
            markGone(file.id);
          }
          throw err;
        }),
    }));

    try {
      await streamFilesAsZip(entries, writable);
    } catch (err) {
      if (err instanceof FileGoneError) {
        // 途中まで書いた .zip は不完全。どのファイルが消えたかは markGone で
        // 一覧に反映済みなので、押し直せば残りのファイルでやり直せる。
        throw new FriendlyError(
          "一部のファイルが既に削除されていたため、一括ダウンロードを中止しました。もう一度お試しください。"
        );
      }
      throw err;
    }

    return { cancelled: false, goneFileIds, started: true };
  }

  // --- 2. フォルダへ1ファイルずつストリーミング保存 ---
  if (directoryPicker) {
    let directory;
    try {
      directory = await directoryPicker({ mode: "readwrite" });
    } catch (err) {
      if (isAbortError(err)) {
        return { cancelled: true, goneFileIds, started: false };
      }
      throw err;
    }

    const { goneFileIds: gone, savedCount } = await saveDecryptedFilesToDirectory(
      directory,
      named,
      key
    );
    for (const id of gone) {
      markGone(id);
    }

    if (savedCount === 0) {
      throw new FriendlyError(FILE_GONE_ERROR);
    }

    return { cancelled: false, goneFileIds, started: true };
  }

  // --- 3. File System Access API 非対応: メモリ内 ZIP(サイズ制限つき) ---
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);

  if (totalBytes > IN_MEMORY_ZIP_MAX_BYTES) {
    throw new FriendlyError(
      "合計サイズが大きいため、この環境では一括ダウンロードできません。ファイルを1つずつダウンロードするか、Chrome / Edge をお使いください。"
    );
  }

  const zipInput: Record<string, Uint8Array> = {};

  for (const { file, name } of named) {
    try {
      zipInput[name] = await fetchAndDecrypt(file, key);
    } catch (err) {
      if (err instanceof FileGoneError) {
        markGone(file.id);
      } else {
        throw err;
      }
    }
  }

  if (Object.keys(zipInput).length === 0) {
    throw new FriendlyError(FILE_GONE_ERROR);
  }

  triggerBlobDownload([await zipFiles(zipInput)], "anzdrop.zip");
  return { cancelled: false, goneFileIds, started: true };
}
