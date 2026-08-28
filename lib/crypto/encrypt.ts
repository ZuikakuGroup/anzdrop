import { generateIV } from "./key";
import type { EncryptionResult } from "./types";

// 1チャンクをAES-256-GCMで暗号化する。aadを渡すと、GCMの認証タグの計算に
// AAD(Additional Authenticated Data)としてバインドされる(送受信はされず、
// 復号側も同じ入力から独立に再計算して照合する)。
export async function encryptChunk(
  plaintext: Uint8Array,
  key: CryptoKey,
  aad?: Uint8Array
): Promise<EncryptionResult> {
  const iv = generateIV();

  // plaintextはSharedArrayBufferを裏付けに持つことがない(このプロジェクトでは
  // 常に通常のArrayBuffer由来)ため、BufferSourceとして安全に渡せる。
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      ...(aad ? { additionalData: aad as BufferSource } : {}),
    },
    key,
    plaintext as BufferSource
  );

  return {
    iv,
    ciphertext,
  };
}