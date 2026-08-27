import {
  importKey,
  decodeBase64Url,
  unpackChunk,
  decryptChunk,
  iterateDecryptedChunks,
  deriveKeyFromPassword,
} from "@/lib/crypto";
import { FileGoneError, FriendlyError, FILE_GONE_ERROR } from "./errors";

export type RawFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

export type DecryptedFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

export async function decryptFileName(
  encryptedName: string,
  key: CryptoKey
): Promise<string> {
  const packed = new Uint8Array(decodeBase64Url(encryptedName));
  const { iv, ciphertext } = unpackChunk(packed);
  const decrypted = await decryptChunk(ciphertext, iv, key);

  return new TextDecoder().decode(decrypted);
}

export async function decryptFileList(
  rawFiles: RawFile[],
  key: CryptoKey
): Promise<DecryptedFile[]> {
  return Promise.all(
    rawFiles.map(async (file) => ({
      id: file.id,
      name: await decryptFileName(file.name, key),
      size: file.size,
      isOneTime: file.isOneTime,
    }))
  );
}

export async function unwrapKeyWithPassword(
  wrappedKey: string,
  keySalt: string,
  password: string
): Promise<CryptoKey> {
  const salt = new Uint8Array(decodeBase64Url(keySalt));
  const kek = await deriveKeyFromPassword(password, salt);
  const packed = new Uint8Array(decodeBase64Url(wrappedKey));
  const { iv, ciphertext } = unpackChunk(packed);
  const rawKey = await decryptChunk(ciphertext, iv, kek);

  return importKey(rawKey);
}

export async function fetchAndDecrypt(
  file: DecryptedFile,
  key: CryptoKey
): Promise<Uint8Array> {
  const response = await fetch(`/api/file/${file.id}`);

  if (response.status === 404) {
    throw new FileGoneError(FILE_GONE_ERROR);
  }

  if (!response.ok || !response.body) {
    throw new FriendlyError("ダウンロードに失敗しました。");
  }

  const chunks: Uint8Array[] = [];

  for await (const decrypted of iterateDecryptedChunks(
    response.body,
    key,
    file.size
  )) {
    chunks.push(decrypted);
  }

  const totalLength = chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0
  );
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}
