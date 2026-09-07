import { SIZE_BUCKETS, type SizeBucket } from "@/lib/analytics/schema";

const MB = 1024 * 1024;
const GB = 1024 * MB;

// 要件書11章。正確なバイト数ではなくbucket化した値だけを送信する。
export function getSizeBucket(totalBytes: number): SizeBucket {
  if (totalBytes < 10 * MB) return SIZE_BUCKETS[0];
  if (totalBytes < 100 * MB) return SIZE_BUCKETS[1];
  if (totalBytes < 500 * MB) return SIZE_BUCKETS[2];
  if (totalBytes < 1 * GB) return SIZE_BUCKETS[3];
  if (totalBytes < 5 * GB) return SIZE_BUCKETS[4];
  if (totalBytes < 10 * GB) return SIZE_BUCKETS[5];

  return SIZE_BUCKETS[6];
}
