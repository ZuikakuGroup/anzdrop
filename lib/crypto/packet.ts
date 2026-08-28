import {
  CHUNK_SIZE,
  FILE_SALT_LENGTH,
  GCM_TAG_LENGTH,
  IV_LENGTH,
  PACKED_CHUNK_SIZE,
  type EncryptionResult,
} from "./types";

// 暗号化チャンクをバイナリ化する
export function packChunk(
  encrypted: EncryptionResult
): Uint8Array {
  const cipher = new Uint8Array(encrypted.ciphertext);

  const result = new Uint8Array(
    IV_LENGTH + cipher.byteLength
  );

  result.set(encrypted.iv, 0);
  result.set(cipher, IV_LENGTH);

  return result;
}

// バイナリから暗号化チャンクを取り出す
export function unpackChunk(
  data: Uint8Array
): EncryptionResult {

  if (data.byteLength < IV_LENGTH) {
    throw new Error("Invalid encrypted chunk.");
  }

  const iv = data.slice(0, IV_LENGTH);

  const cipher = data.slice(IV_LENGTH);

  const ciphertext = cipher.buffer.slice(
    cipher.byteOffset,
    cipher.byteOffset + cipher.byteLength
  );

  return {
    iv,
    ciphertext,
  };
}

// アップロードされた暗号化オブジェクトの実サイズ(ストレージが報告する、
// 改ざん不可能な値)から、元の平文サイズを一意に逆算する。各パケットは
// 平文と同じ長さの暗号文にIV+GCMタグ(固定28バイト)を加えた構造を持つため、
// パケット数さえ求まれば平文サイズを一意に復元できる。クライアント申告の
// サイズを一切信用せずに平文サイズを検証したい場面(アップロード完了時の
// サイズ再検証、ダウンロード時の欠損検出)で使う。
//
// この関数は「新規にアップロードが完了したファイル」だけに使う想定で、
// iterateEncryptedChunks(lib/crypto/stream.ts)が先頭に埋め込む
// FILE_SALT_LENGTHバイトのsaltを含む前提で計算する(AAD保護導入前に
// アップロード済みの、saltを含まない既存ファイルのsizeは、当時この関数で
// 計算されてD1に保存済みのため再計算されず、この変更の影響を受けない)。
export function getPlaintextSizeFromCiphertextSize(
  ciphertextSize: number
): number {
  if (ciphertextSize < FILE_SALT_LENGTH) {
    throw new Error("Invalid ciphertext size.");
  }

  const packetStreamSize = ciphertextSize - FILE_SALT_LENGTH;
  const packetOverhead = IV_LENGTH + GCM_TAG_LENGTH;
  const fullPackets = Math.floor(packetStreamSize / PACKED_CHUNK_SIZE);
  const remainder = packetStreamSize - fullPackets * PACKED_CHUNK_SIZE;

  if (remainder === 0) {
    return fullPackets * CHUNK_SIZE;
  }

  if (remainder <= packetOverhead) {
    throw new Error("Invalid ciphertext size.");
  }

  return fullPackets * CHUNK_SIZE + (remainder - packetOverhead);
}