import { packChunk, unpackChunk } from "./packet";
import { encryptChunk } from "./encrypt";
import { decryptChunk } from "./decrypt";
import { buildChunkAad } from "./aad";
import { generateFileSalt } from "./key";
import { CHUNK_SIZE, FILE_SALT_LENGTH, PACKED_CHUNK_SIZE } from "./types";

// Fileを一定サイズずつ読み込む
export async function* iterateFileChunks(
  file: File
): AsyncGenerator<Uint8Array> {
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(
      offset + CHUNK_SIZE,
      file.size
    );
    const chunk = file.slice(offset, end);
    const buffer = await chunk.arrayBuffer();

    yield new Uint8Array(buffer);
    offset = end;
  }
}

// 暗号化済みチャンクを順番に取り出す。各チャンクの認証タグに、ストリーム内
// での位置(何番目か・最終チャンクか)とファイルごとのランダムなsaltをAAD
// としてバインドすることで、ストレージ上でのチャンクの並べ替え・重複・
// (鍵を使い回す同一share内の別ファイルとの)差し替えを検知できるように
// する(詳細はGitHub issue #1)。saltは秘匿する必要がないため、先頭パケット
// の直前に平文のまま1回だけ埋め込む。
export async function* iterateEncryptedChunks(
  file: File,
  key: CryptoKey
): AsyncGenerator<Uint8Array> {
  const fileSalt = generateFileSalt();
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let index = 0;

  for await (const chunk of iterateFileChunks(file)) {
    const isLast = index === totalChunks - 1;
    const aad = buildChunkAad({ fileSalt, index, isLast });
    const encrypted = await encryptChunk(chunk, key, aad);
    const packed = packChunk(encrypted);

    if (index === 0) {
      const withSalt = new Uint8Array(
        FILE_SALT_LENGTH + packed.byteLength
      );
      withSalt.set(fileSalt, 0);
      withSalt.set(packed, FILE_SALT_LENGTH);
      yield withSalt;
    } else {
      yield packed;
    }

    index++;
  }
}

function corruptedDataError(): Error {
  return new Error(
    "ファイルの復号に失敗しました。データが破損しているか、改ざんされている可能性があります。"
  );
}

// バイトストリームからパケット境界を切り出し、復号済みチャンクを順番に
// 取り出す。
//
// このコードでアップロードされたファイル(新形式)は、ストリーム先頭に
// ファイル固有のランダムなsalt(FILE_SALT_LENGTHバイト、秘匿不要)を持ち、
// 各パケットの認証タグにそのsalt・チャンク番号・最終チャンクか否かをAADと
// してバインドしている。これにより、ストレージを操作できる主体による
// チャンクの並べ替え・重複・(鍵を使い回す同一share内の)別ファイルとの
// 差し替えを検知できる(GitHub issue #1)。
//
// AAD導入前にアップロードされた既存ファイル(旧形式: saltなし・AADなし)も
// 引き続き復号できるよう、先頭パケットはまず新形式として検証を試み、失敗
// した場合のみ旧形式として読み直す。新形式のファイルがこのフォールバック
// を経由して弱い検証をすり抜けることはない。旧形式としての検証も結局は
// (AADなしの)GCM認証タグの一致を要求しており、鍵を持たない攻撃者は新形式
// で計算された認証タグを別の入力で再現できないため。
//
// expectedTotalBytesを渡すと、末尾パケットが丸ごと欠落したまま(GCM認証
// エラーを経由せずに)ストリームが終了するケース(切断・改ざんによる無音の
// 切り詰め)を検出する。
export async function* iterateDecryptedChunks(
  stream: ReadableStream<Uint8Array>,
  key: CryptoKey,
  expectedTotalBytes?: number
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  let pendingLength = 0;
  let streamDone = false;
  let decryptedTotal = 0;

  const fillTo = async (minBytes: number): Promise<void> => {
    while (pendingLength < minBytes && !streamDone) {
      const { value, done } = await reader.read();

      if (value && value.byteLength > 0) {
        pending.push(value);
        pendingLength += value.byteLength;
      }

      if (done) {
        streamDone = true;
      }
    }
  };

  // pendingの先頭からlengthバイトを消費せずにコピーする(不足分は含めない
  // 前提で、呼び出し側がpendingLength >= lengthを保証する)。
  const peek = (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let offset = 0;

    for (const piece of pending) {
      if (offset >= length) break;
      const take = Math.min(piece.byteLength, length - offset);
      out.set(piece.subarray(0, take), offset);
      offset += take;
    }

    return out;
  };

  const drop = (length: number): void => {
    let remaining = length;

    while (remaining > 0) {
      const piece = pending[0];

      if (piece.byteLength <= remaining) {
        remaining -= piece.byteLength;
        pending.shift();
      } else {
        pending[0] = piece.subarray(remaining);
        remaining = 0;
      }
    }

    pendingLength -= length;
  };

  // consumedOffsetより後ろにある次のパケットのサイズと、それがストリーム
  // 最後のパケットかどうかを、1バイトの先読みによって確定させる
  // (パケットがちょうどPACKED_CHUNK_SIZEの場合に「続きがあるか」を
  // 曖昧にしないため)。
  const nextPacketBounds = async (
    consumedOffset: number
  ): Promise<{ size: number; isLast: boolean } | null> => {
    await fillTo(consumedOffset + PACKED_CHUNK_SIZE + 1);
    const available = pendingLength - consumedOffset;

    if (available <= 0) {
      return null;
    }

    if (available > PACKED_CHUNK_SIZE) {
      return { size: PACKED_CHUNK_SIZE, isLast: false };
    }

    return { size: available, isLast: true };
  };

  await fillTo(FILE_SALT_LENGTH);

  if (pendingLength === 0) {
    // 空のダウンロード(0バイトのオブジェクト)。
    return;
  }

  // ---- 1. 先頭パケットで新形式(salt + AAD)を試し、ダメなら旧形式に
  //         フォールバックする ----
  const candidateSalt =
    pendingLength >= FILE_SALT_LENGTH ? peek(FILE_SALT_LENGTH) : null;
  const newFormatBounds = candidateSalt
    ? await nextPacketBounds(FILE_SALT_LENGTH)
    : null;

  let fileSalt: Uint8Array | null = null;
  let index = 0;

  if (candidateSalt && newFormatBounds) {
    const candidatePacket = peek(
      FILE_SALT_LENGTH + newFormatBounds.size
    ).subarray(FILE_SALT_LENGTH);

    try {
      const { iv, ciphertext } = unpackChunk(candidatePacket);
      const aad = buildChunkAad({
        fileSalt: candidateSalt,
        index: 0,
        isLast: newFormatBounds.isLast,
      });
      const decrypted = new Uint8Array(
        await decryptChunk(ciphertext, iv, key, aad)
      );

      fileSalt = candidateSalt;
      drop(FILE_SALT_LENGTH + newFormatBounds.size);
      decryptedTotal += decrypted.byteLength;
      yield decrypted;
      index = 1;
    } catch {
      // 新形式としては検証できなかった。pendingは未消費のまま、下の
      // メインループで旧形式(先頭からAADなし)として読み直す。
    }
  }

  // ---- 2. 残りのパケット(新形式なら2チャンク目以降、旧形式ならすべて)
  //         を、確定したフォーマットで順番に処理する ----
  while (true) {
    const bounds = await nextPacketBounds(0);

    if (!bounds) {
      break;
    }

    const packet = peek(bounds.size);

    let decrypted: Uint8Array;

    try {
      const { iv, ciphertext } = unpackChunk(packet);
      const aad =
        fileSalt !== null
          ? buildChunkAad({ fileSalt, index, isLast: bounds.isLast })
          : undefined;

      decrypted = new Uint8Array(
        await decryptChunk(ciphertext, iv, key, aad)
      );
    } catch {
      throw corruptedDataError();
    }

    drop(bounds.size);
    decryptedTotal += decrypted.byteLength;
    yield decrypted;
    index++;

    if (bounds.isLast) {
      break;
    }
  }

  if (
    expectedTotalBytes !== undefined &&
    decryptedTotal !== expectedTotalBytes
  ) {
    throw new Error(
      `ダウンロードが途中で切断されました(受信 ${decryptedTotal} / 期待 ${expectedTotalBytes} バイト)。`
    );
  }
}
