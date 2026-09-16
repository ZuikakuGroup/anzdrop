// クライアントとサーバーで共有する、計測イベントの軽量な定義。
// Zod を使う詳細なリクエスト検証は schema.ts に残し、初期表示の
// クライアントバンドルへ検証ライブラリを含めないようにする。

export const ANALYTICS_EVENT_NAMES = [
  "landing_view",
  "file_select",
  "upload_start",
  "upload_success",
  "upload_error",
  "share_link_copy",
  "share_native",
  "download_start",
  "download_success",
  "download_error",
  "recipient_send_cta_view",
  "recipient_send_cta_click",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const UPLOAD_ERROR_CODES = [
  "UPLOAD_NETWORK_ERROR",
  "UPLOAD_STORAGE_ERROR",
  "UPLOAD_TIMEOUT",
  "UPLOAD_ENCRYPTION_ERROR",
  "UPLOAD_CANCELLED",
  "UPLOAD_UNKNOWN",
] as const;
export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export const DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_NETWORK_ERROR",
  "DOWNLOAD_NOT_FOUND",
  "DOWNLOAD_EXPIRED",
  "DOWNLOAD_DECRYPTION_ERROR",
  "DOWNLOAD_CANCELLED",
  "DOWNLOAD_UNKNOWN",
] as const;
export type DownloadErrorCode = (typeof DOWNLOAD_ERROR_CODES)[number];

export const SIZE_BUCKETS = [
  "<10MB",
  "10-100MB",
  "100MB-500MB",
  "500MB-1GB",
  "1GB-5GB",
  "5GB-10GB",
  "10GB+",
] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const DEVICE_CLASSES = ["desktop", "mobile", "tablet", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const MAX_EVENTS_PER_BATCH = 20;

// Privacy Guard: クライアントでは計測キュー投入前に、サーバーでは保存前に使う。
export const FORBIDDEN_PROPERTY_KEYS = [
  "filename",
  "fileName",
  "key",
  "encryptionKey",
  "decryptionKey",
  "url",
  "fullUrl",
  "hash",
  "fragment",
  "email",
  "ip",
  "ipAddress",
] as const;

export function findForbiddenPropertyKeys(properties: unknown): string[] {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }

  const forbidden: readonly string[] = FORBIDDEN_PROPERTY_KEYS;

  return Object.keys(properties as Record<string, unknown>).filter((key) =>
    forbidden.includes(key)
  );
}
