import {
  encryptChunk,
  packChunk,
  encodeBase64Url,
  generateSalt,
  deriveKeyFromPassword,
  exportKey,
} from "@/lib/crypto";

export async function encryptFileName(
  name: string,
  key: CryptoKey
): Promise<string> {
  const nameBytes = new TextEncoder().encode(name);
  const encrypted = await encryptChunk(nameBytes, key);
  const packed = packChunk(encrypted);

  return encodeBase64Url(packed);
}

export async function wrapKeyWithPassword(
  key: CryptoKey,
  password: string
): Promise<{ wrappedKey: string; keySalt: string }> {
  const salt = generateSalt();
  const kek = await deriveKeyFromPassword(password, salt);
  const rawKey = await exportKey(key);
  const encrypted = await encryptChunk(rawKey, kek);
  const packed = packChunk(encrypted);

  return {
    wrappedKey: encodeBase64Url(packed),
    keySalt: encodeBase64Url(salt),
  };
}
