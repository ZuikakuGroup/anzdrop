export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB

export const AES_KEY_LENGTH = 256;

export const IV_LENGTH = 12;

export const PBKDF2_SALT_LENGTH = 16;

export const PBKDF2_ITERATIONS = 600_000;

export const GCM_TAG_LENGTH = 16;

// IV + 暗号文(平文と同サイズ) + GCMタグ、を1パケットとしたときの最大サイズ
export const PACKED_CHUNK_SIZE = CHUNK_SIZE + IV_LENGTH + GCM_TAG_LENGTH;

export type EncryptionResult = {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};