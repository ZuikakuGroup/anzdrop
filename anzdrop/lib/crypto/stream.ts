import { packChunk, unpackChunk } from "./packet";
import { encryptChunk } from "./encrypt";
import { decryptChunk } from "./decrypt";
import { CHUNK_SIZE, PACKED_CHUNK_SIZE } from "./types";

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

// バイトストリームからパケット境界(最終パケットを除き固定長PACKED_CHUNK_SIZE)を切り出し、
// 復号済みチャンクを順番に取り出す
export async function* iterateDecryptedChunks(
  stream: ReadableStream<Uint8Array>,
  key: CryptoKey
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  let pendingLength = 0;

  const takePacket = async (size: number): Promise<Uint8Array> => {
    const packet = new Uint8Array(size);
    let offset = 0;

    while (offset < size) {
      const piece = pending[0];
      const need = size - offset;

      if (piece.byteLength <= need) {
        packet.set(piece, offset);
        offset += piece.byteLength;
        pending.shift();
      } else {
        packet.set(piece.subarray(0, need), offset);
        pending[0] = piece.subarray(need);
        offset += need;
      }
    }

    pendingLength -= size;

    const { iv, ciphertext } = unpackChunk(packet);
    const decrypted = await decryptChunk(ciphertext, iv, key);

    return new Uint8Array(decrypted);
  };

  while (true) {
    const { value, done } = await reader.read();

    if (value && value.byteLength > 0) {
      pending.push(value);
      pendingLength += value.byteLength;

      while (pendingLength >= PACKED_CHUNK_SIZE) {
        yield await takePacket(PACKED_CHUNK_SIZE);
      }
    }

    if (done) {
      if (pendingLength > 0) {
        yield await takePacket(pendingLength);
      }
      break;
    }
  }
}