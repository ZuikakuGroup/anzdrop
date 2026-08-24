import { IV_LENGTH, type EncryptionResult } from "./types";

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