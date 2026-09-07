import {
  EXPIRED_LINK_MESSAGE,
  FileGoneError,
  FriendlyError,
  INVALID_LINK_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SUSPENDED_SHARE_MESSAGE,
} from "@/lib/download/errors";
import type { DownloadErrorCode, UploadErrorCode } from "@/lib/analytics/schema";

// 要件書31章。自由形式のエラーメッセージはそのまま送らず、定義済みコードへ
// 丸める。既存のエラー型(lib/download/errors.ts)が区別している範囲でしか
// 分類できないため、それ以外は各カテゴリの*_UNKNOWNへ丸める。
export function classifyDownloadError(error: unknown): DownloadErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "DOWNLOAD_CANCELLED";
  }

  if (error instanceof FileGoneError) {
    return "DOWNLOAD_NOT_FOUND";
  }

  if (error instanceof FriendlyError) {
    switch (error.message) {
      case INVALID_LINK_MESSAGE:
      case SUSPENDED_SHARE_MESSAGE:
        return "DOWNLOAD_NOT_FOUND";
      case EXPIRED_LINK_MESSAGE:
        return "DOWNLOAD_EXPIRED";
      case RATE_LIMITED_MESSAGE:
        return "DOWNLOAD_NETWORK_ERROR";
      default:
        return "DOWNLOAD_UNKNOWN";
    }
  }

  if (error instanceof TypeError) {
    return "DOWNLOAD_NETWORK_ERROR";
  }

  return "DOWNLOAD_UNKNOWN";
}

export function classifyUploadError(error: unknown): UploadErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "UPLOAD_CANCELLED";
  }

  if (error instanceof TypeError) {
    return "UPLOAD_NETWORK_ERROR";
  }

  return "UPLOAD_UNKNOWN";
}
