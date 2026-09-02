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
  canSaveViaServiceWorker,
  saveViaServiceWorker,
} from "./streamDownloadSaver";
import {
  canStreamFilesAsZip,
  streamFilesAsZip,
  withDuplicateSuffix,
  zipFiles,
  type ZipEntrySource,
  type ZipWritableSink,
} from "./zipDownload";

// File System Access API も Service Worker も使えない環境でメモリ内 ZIP を
// 許容する合計サイズの上限。復号済み平文 + fflate の非ストリーミング出力を
// まとめてメモリに載せるため実効ピークは倍になりうる。低スペック端末での
// OOM を避けるため保守的に。これを超える場合は個別ダウンロードを案内する。
export const IN_MEMORY_ZIP_MAX_BYTES = 512 * 1024 * 1024; // 512 MiB

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

// WritableStream を streamFilesAsZip が要求する sink 形へ薄くラップする。
function writableStreamToSink(
  writable: WritableStream<Uint8Array>
): ZipWritableSink {
  const writer = writable.getWriter();

  return {
    write: (chunk) => writer.write(chunk),
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  };
}

// 共有内の全ファイルを一括ダウンロードする。環境と合計サイズに応じて経路を選ぶ:
//
// 1. showSaveFilePicker(Chromium 系)かつ zip64 不要 → ストリーミング ZIP を
//    選んだ .zip ファイルへ直接書き出す(1ファイル分も ZIP 全体もメモリに
//    載せない。GitHub issue #59)。
// 2. showSaveFilePicker が無く Service Worker が使える(Firefox/Safari)かつ
//    zip64 不要 → Service Worker 経由でストリーミング ZIP をダウンロード
//    (GitHub issue #61)。
// 3. showDirectoryPicker(Chromium 系で 4GiB 超) → フォルダを選んで1ファイル
//    ずつストリーミング保存。
// 4. どのストリーミング経路も使えない → 合計サイズが上限内ならメモリ内 ZIP、
//    超える場合は個別ダウンロードを案内して中断。
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

  const zipEntries: ZipEntrySource[] = named.map(({ file, name }) => ({
    name,
    open: () =>
      fetchDecryptedStream(file, key).catch((err) => {
        if (err instanceof FileGoneError) {
          markGone(file.id);
        }
        throw err;
      }),
  }));

  const toStreamingZipMidwayError = (err: unknown): unknown =>
    err instanceof FileGoneError
      ? // 途中まで書いた .zip は不完全。どのファイルが消えたかは markGone で
        // 一覧に反映済みなので、押し直せば残りのファイルでやり直せる。
        new FriendlyError(
          "一部のファイルが既に削除されていたため、一括ダウンロードを中止しました。もう一度お試しください。"
        )
      : err;

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

    try {
      await streamFilesAsZip(zipEntries, writable);
    } catch (err) {
      throw toStreamingZipMidwayError(err);
    }

    return { cancelled: false, goneFileIds, started: true };
  }

  // --- 2. Service Worker 経由でストリーミング ZIP をダウンロード ---
  //    (Firefox/Safari。showSaveFilePicker が無く Service Worker が使える場合)
  if (canStreamFilesAsZip(sizes) && (await canSaveViaServiceWorker())) {
    const transform = new TransformStream<Uint8Array, Uint8Array>();
    const sink = writableStreamToSink(transform.writable);

    // 先に ZIP 生成を走らせておく(SW がまだ readable を消費していない間は
    // writable のバックプレッシャーで自然に待つ)。unhandledrejection を
    // 避けるため .catch でエラーを受けておき、下で必ず待つ。
    let zipError: unknown = null;
    const zipPromise = streamFilesAsZip(zipEntries, sink).catch(
      (err: unknown) => {
        zipError = err;
      }
    );

    try {
      await saveViaServiceWorker(transform.readable, "anzdrop.zip", null);
    } catch (swError) {
      // SW への受け渡しに失敗。ZIP 生成側を止めてから後始末する。
      await sink.abort(swError).catch(() => {});
      await zipPromise;

      // canSaveViaServiceWorker() で SW との往復は確認済みなので、ここで失敗
      // するのはまれな一過性。この時点で zipEntries の一部は既に fetch 済み
      // (1回限りファイルならダウンロード枠を消費済み)。メモリ内 ZIP へ
      // フォールバックすると再 fetch でそれらを失わせるため、リトライを促す。
      throw swError instanceof FriendlyError
        ? swError
        : new FriendlyError(
            "一括ダウンロードを開始できませんでした。もう一度お試しください。"
          );
    }

    await zipPromise;

    if (zipError) {
      throw toStreamingZipMidwayError(zipError);
    }

    return { cancelled: false, goneFileIds, started: true };
  }

  // --- 3. フォルダへ1ファイルずつストリーミング保存 ---
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

  // --- 4. どのストリーミング経路も使えない: メモリ内 ZIP(サイズ制限つき) ---
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);

  if (totalBytes > IN_MEMORY_ZIP_MAX_BYTES) {
    throw new FriendlyError(
      "合計サイズが大きいため、この環境では一括ダウンロードできません。ファイルを1つずつダウンロードしてください。"
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
