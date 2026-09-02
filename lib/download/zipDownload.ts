import { zip, Zip, ZipPassThrough } from "fflate";

export function withDuplicateSuffix(name: string, count: number): string {
  if (count === 0) {
    return name;
  }

  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";

  return `${base} (${count})${ext}`;
}

// 非ストリーミングの ZIP 生成(fflate の zip())。入力・出力を丸ごとメモリに
// 載せるため、File System Access API が使えない環境(Firefox/Safari)向けの
// フォールバックでのみ使う。呼び出し側は合計サイズを事前に制限すること。
export function zipFiles(
  input: Record<string, Uint8Array>
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(input, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

// fflate の Zip はローカルファイルヘッダ・データ記述子・End Of Central Directory の
// サイズ/オフセットをすべて 32bit で書く(zip64 非対応)。1ファイルの平文サイズ、
// または ZIP 出力全体が 0xFFFFFFFF(4GiB - 1)を超えると値が切り詰められて
// 壊れた ZIP になるため、その手前でストリーミング ZIP をあきらめて別手段
// (フォルダへ1ファイルずつ保存)へフォールバックする。
export const ZIP_NO_ZIP64_LIMIT = 0xffffffff;

// エントリ1件あたりの ZIP 構造上のオーバーヘッド概算(ローカルヘッダ + データ
// 記述子 + 中央ディレクトリ項目)。ファイル名の実バイト長は考慮せず、UTF-8 で
// 名前が長くても収まるよう保守的に大きめに取る。
const ZIP_ENTRY_OVERHEAD_BYTES = 1024;

// 与えられたファイル群を、fflate のストリーミング ZIP で安全にまとめられるか
// (= zip64 が不要な範囲に収まるか)。
export function canStreamFilesAsZip(sizes: number[]): boolean {
  if (sizes.some((size) => size > ZIP_NO_ZIP64_LIMIT - ZIP_ENTRY_OVERHEAD_BYTES)) {
    return false;
  }

  const estimatedTotal = sizes.reduce(
    (sum, size) => sum + size + ZIP_ENTRY_OVERHEAD_BYTES,
    22 // EOCD レコード
  );

  return estimatedTotal <= ZIP_NO_ZIP64_LIMIT;
}

export type ZipEntrySource = {
  // ZIP 内でのファイル名(重複回避の連番付与済み)。
  name: string;
  // このエントリのバイト列を流す ReadableStream を「その場で」開くファクトリ。
  // 呼び出しは順次1件ずつ行われる(全ファイルへの並行 fetch を避けるため)。
  open: () => Promise<ReadableStream<Uint8Array>>;
};

export type ZipWritableSink = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};

// 各エントリの平文ストリームを順に fflate の Zip(store、無圧縮)へ流し込み、
// 生成された ZIP バイト列をそのまま sink(ディスクの FileSystemWritableFileStream
// など)へ書き出す。1ファイル分も ZIP 出力全体もメモリに保持しない
// (GitHub issue #59)。暗号化済みデータは圧縮が効かないため store を使う
// (deflate だと CPU の無駄 + fflate 側でワーカーが必要になる)。
export async function streamFilesAsZip(
  entries: ZipEntrySource[],
  sink: ZipWritableSink
): Promise<void> {
  // fflate の Zip#ondata は同期的にチャンクを渡してくるので、ディスク書き込み
  // (非同期)を直列化しつつ、その完了を入力側のバックプレッシャーにする。
  let writeChain: Promise<void> = Promise.resolve();
  let zipError: unknown = null;

  const archive = new Zip((err, chunk) => {
    if (err) {
      zipError ??= err;
      return;
    }
    const toWrite = chunk;
    writeChain = writeChain.then(() => sink.write(toWrite));
  });

  try {
    for (const entry of entries) {
      const file = new ZipPassThrough(entry.name);
      archive.add(file);

      const reader = (await entry.open()).getReader();
      let completedNormally = false;

      try {
        for (;;) {
          const { value, done } = await reader.read();

          if (done) {
            completedNormally = true;
            break;
          }

          file.push(value, false);
          await writeChain;

          if (zipError) {
            throw zipError;
          }
        }
      } finally {
        if (!completedNormally) {
          await reader.cancel().catch(() => {});
        }
        reader.releaseLock();
      }

      file.push(new Uint8Array(0), true);
      await writeChain;

      if (zipError) {
        throw zipError;
      }
    }

    archive.end();
    await writeChain;

    if (zipError) {
      throw zipError;
    }

    await sink.close();
  } catch (err) {
    archive.terminate();
    await sink.abort(err).catch(() => {});
    throw err;
  }
}
