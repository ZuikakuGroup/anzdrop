import Spinner from "@/components/brand/Spinner";
import { EyeIcon } from "@/components/brand/ShareIcons";
import { formatBytes } from "@/lib/format";
import { canPreviewFile } from "@/lib/preview";
import type { DecryptedFile } from "@/lib/download/decrypt";

type DownloadFileListProps = {
  files: DecryptedFile[];
  previewAllowed: boolean;
  downloadingId: string;
  isDownloadingAll: boolean;
  previewLoadingId: string;
  onDownload: (file: DecryptedFile) => void;
  onPreview: (file: DecryptedFile) => void;
};

// 復号済みファイル一覧と、個別保存・プレビューの操作ボタン。
export default function DownloadFileList({
  files,
  previewAllowed,
  downloadingId,
  isDownloadingAll,
  previewLoadingId,
  onDownload,
  onPreview,
}: DownloadFileListProps) {
  return (
    <ul className="anz-scroll h-40 divide-y divide-ink/10 overflow-y-auto rounded border-2 border-ink p-2 text-[13px]">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-1">
          <button
            onClick={() => onDownload(file)}
            disabled={
              downloadingId === file.id ||
              isDownloadingAll ||
              !!previewLoadingId
            }
            className="flex min-w-0 flex-1 items-center justify-between gap-4 px-2 py-2 text-left transition-colors hover:bg-ink/[0.03] disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate">
              {file.name}
            </span>
            {downloadingId === file.id ? (
              <Spinner className="h-4 w-4 shrink-0 text-brand" />
            ) : (
              <span className="shrink-0 font-bold text-ink/40">
                {formatBytes(file.size)}
              </span>
            )}
          </button>

          {canPreviewFile({
            shareAllowsPreview: previewAllowed,
            isOneTimeFile: file.isOneTime,
            filename: file.name,
          }) && (
            <button
              onClick={() => onPreview(file)}
              disabled={
                downloadingId === file.id ||
                isDownloadingAll ||
                !!previewLoadingId
              }
              aria-label="プレビュー"
              title="プレビュー"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
            >
              {previewLoadingId === file.id ? (
                <Spinner className="h-4 w-4 text-brand" />
              ) : (
                <EyeIcon className="h-4 w-4" />
              )}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
