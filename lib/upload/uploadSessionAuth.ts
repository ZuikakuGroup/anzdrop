import { timingSafeEqual } from "@/lib/timingSafeEqual";

// R2のマルチパートは最終パート以外が最小5MiB。申告fileSizeからパート番号上限を
// この粒度で見積もり、正当な8MiBパートを弾かずに濫用を抑える(chunk routeと同ロジック)。
export const R2_MULTIPART_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

export const MAX_PART_URLS_PER_REQUEST = 32;
export const MAX_PART_ACKS_PER_REQUEST = 32;

export type UploadSessionRow = {
  storage_key: string;
  upload_id: string;
  file_size: number | null;
  upload_token: string | null;
};

export async function loadUploadSession(
  db: D1Database,
  uploadSessionId: string
): Promise<UploadSessionRow | null> {
  return db
    .prepare(
      `
    SELECT
        uploads.storage_key AS storage_key,
        uploads.upload_id AS upload_id,
        uploads.file_size AS file_size,
        shares.upload_token AS upload_token
    FROM uploads
    JOIN shares ON shares.id = uploads.share_id
    WHERE uploads.id = ?
    LIMIT 1
    `
    )
    .bind(uploadSessionId)
    .first<UploadSessionRow>();
}

export function verifyUploadSessionToken(
  sessionToken: string | null,
  providedToken: string
): boolean {
  return (
    !!sessionToken &&
    timingSafeEqual(
      new TextEncoder().encode(sessionToken),
      new TextEncoder().encode(providedToken)
    )
  );
}

export function maxPartNumberForDeclaredFileSize(declaredFileSize: number): number {
  return Math.max(1, Math.ceil(declaredFileSize / R2_MULTIPART_MIN_PART_SIZE_BYTES));
}

export function isPartNumberAllowed(
  partNumber: number,
  declaredFileSize: number
): boolean {
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    return false;
  }
  return partNumber <= maxPartNumberForDeclaredFileSize(declaredFileSize);
}
