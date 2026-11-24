import { CHUNK_SIZE } from "@/lib/crypto/types";
import { getCiphertextSizeFromPlaintextSize } from "@/lib/crypto/packet";

// 暗号化の8MiBチャンクとは独立したR2パートサイズ。暗号文の形式は変えない。
export const UPLOAD_PART_SIZE = CHUNK_SIZE;
export const MAX_UPLOAD_PARTS = 10_000;
export const MAX_UPLOAD_PART_SIZE = 7 * UPLOAD_PART_SIZE; // 500GBでも56MiBで収まる
const MAX_IN_FLIGHT_PART_BYTES = 96 * 1024 * 1024;

export function getUploadPartSize(fileSize: number): number {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error("Invalid file size");
  }
  const encryptedSize = getCiphertextSizeFromPlaintextSize(fileSize);
  const units = Math.max(1, Math.ceil(encryptedSize / MAX_UPLOAD_PARTS / UPLOAD_PART_SIZE));
  const partSize = units * UPLOAD_PART_SIZE;
  if (partSize > MAX_UPLOAD_PART_SIZE) throw new Error("File exceeds multipart capacity");
  return partSize;
}

// 並列数を維持したままパートだけ拡大するとメモリが増えるため、合計96MiBに制限。
export function getPartUploadConcurrency(concurrency: number, partSize: number): number {
  return Math.max(1, Math.min(concurrency, Math.floor(MAX_IN_FLIGHT_PART_BYTES / partSize)));
}
