import { FILE_SALT_LENGTH } from "./types";

export type ChunkAadInput = {
  fileSalt: Uint8Array;
  index: number;
  isLast: boolean;
};

// ストリーム内でのチャンクの位置(何番目か・最終チャンクか)とファイルごとの
// ランダムなsaltを、GCMのAAD(Additional Authenticated Data)としてチャンクの
// 認証タグにバインドする。これにより、ストレージを操作できる主体による
// チャンクの並べ替え・重複・(鍵を共有する同一share内の)別ファイルの
// チャンクとの差し替えを検知できるようにする(GitHub issue #1)。
// AADは送受信されず、暗号化・復号の両側で同じ入力から独立に計算する。
export function buildChunkAad({
  fileSalt,
  index,
  isLast,
}: ChunkAadInput): Uint8Array {
  if (fileSalt.byteLength !== FILE_SALT_LENGTH) {
    throw new Error("Invalid file salt length.");
  }

  const aad = new Uint8Array(FILE_SALT_LENGTH + 5);
  aad.set(fileSalt, 0);
  new DataView(aad.buffer).setUint32(FILE_SALT_LENGTH, index, false);
  aad[FILE_SALT_LENGTH + 4] = isLast ? 1 : 0;

  return aad;
}
