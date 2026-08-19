import { packChunk } from "./packet";
import { encryptChunk } from "./encrypt";
import { CHUNK_SIZE } from "./types";

// Fileを一定サイズずつ読み込む
export async function* iterateFileChunks(
  file: File
): AsyncGenerator<Uint8Array> {
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(
      offset + CHUNK_SIZE,
      file.size
    );
    const chunk = file.slice(offset, end);
    const buffer = await chunk.arrayBuffer();

    yield new Uint8Array(buffer);
    offset = end;
  }
}

// 暗号化済みチャンクを順番に取り出す
export async function* iterateEncryptedChunks(
  file: File,
  key: CryptoKey
): AsyncGenerator<Uint8Array> {
  for await (const chunk of iterateFileChunks(file)) {
    const encrypted = await encryptChunk(chunk, key);

    yield packChunk(encrypted);
  }
}