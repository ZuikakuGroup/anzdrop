import { generateIV } from "./key";
import type { EncryptionResult } from "./types";

// 1チャンクをAES-256-GCMで暗号化する
export async function encryptChunk(
  plaintext: Uint8Array,
  key: CryptoKey
): Promise<EncryptionResult> {
  const iv = generateIV();

  // plaintextはSharedArrayBufferを裏付けに持つことがない(このプロジェクトでは
  // 常に通常のArrayBuffer由来)ため、BufferSourceとして安全に渡せる。
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plaintext as BufferSource
  );

  return {
    iv,
    ciphertext,
  };
}