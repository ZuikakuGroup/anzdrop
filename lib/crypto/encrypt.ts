import { generateIV } from "./key";
import type { EncryptionResult } from "./types";

// 1チャンクをAES-256-GCMで暗号化する
export async function encryptChunk(
  plaintext: Uint8Array,
  key: CryptoKey
): Promise<EncryptionResult> {
  const iv = generateIV();

  const data = Uint8Array.from(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    data
  );

  return {
    iv,
    ciphertext,
  };
}