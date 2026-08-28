// 1チャンクをAES-256-GCMで復号する。aadは暗号化時に渡したものと完全に
// 一致していなければ認証タグの検証に失敗する(encryptChunkのコメント参照)。
export async function decryptChunk(
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  key: CryptoKey,
  aad?: Uint8Array
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv),
      ...(aad ? { additionalData: aad as BufferSource } : {}),
    },
    key,
    ciphertext
  );
}