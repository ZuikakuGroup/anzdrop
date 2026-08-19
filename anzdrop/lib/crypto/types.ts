export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB

export const AES_KEY_LENGTH = 256;

export const IV_LENGTH = 12;

export type EncryptionResult = {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};