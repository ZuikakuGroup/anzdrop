import type { ApiResponse } from "@/lib/api/response";

export type DownloadResponseFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

export type DownloadResponseShare = {
  id: string;
  expires_at: string;
  wrappedKey: string | null;
  keySalt: string | null;
  previewAllowed: boolean;
};

export type DownloadResponse = ApiResponse<{
  share: DownloadResponseShare;
  files: DownloadResponseFile[];
  // 計測基盤(要件定義書v1.0)がupload/downloadイベントを相関するための
  // shareIdの一方向ハッシュ(lib/analytics/transferId.ts)。
  analyticsTransferId: string;
}>;
