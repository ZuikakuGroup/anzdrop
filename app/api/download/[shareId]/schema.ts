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
}>;
