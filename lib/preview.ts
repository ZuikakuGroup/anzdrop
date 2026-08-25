// ブラウザ内プレビュー(有料プラン限定)の対応拡張子。要件どおり
// メジャーな拡張子(MP4/MP3/JPEG/PNG)のみに限定し、無闇に広げない。
const PREVIEW_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// components/download/DownloadPage.tsxのwithDuplicateSuffixと同じ
// 「先頭がドットの隠しファイルは拡張子扱いしない」ルールに揃える。
function getExtension(filename: string): string | null {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return null;
  }

  return filename.slice(dotIndex + 1).toLowerCase();
}

export function guessPreviewMimeType(filename: string): string | null {
  const ext = getExtension(filename);

  return ext ? (PREVIEW_MIME_TYPES[ext] ?? null) : null;
}

export function isPreviewableFile(filename: string): boolean {
  return guessPreviewMimeType(filename) !== null;
}

export type PreviewKind = "video" | "audio" | "image";

export function getPreviewKind(mimeType: string): PreviewKind | null {
  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  return null;
}

// そのファイルにプレビューのアイコンを出してよいか。共有がプレビュー
// 非対応(無料プラン)、またはそのファイルが保存期間「1回」の場合は、
// /api/file/[fileId]の1回限りのダウンロード枠と衝突するため無条件で不可。
export function canPreviewFile(params: {
  shareAllowsPreview: boolean;
  isOneTimeFile: boolean;
  filename: string;
}): boolean {
  if (!params.shareAllowsPreview || params.isOneTimeFile) {
    return false;
  }

  return isPreviewableFile(params.filename);
}
