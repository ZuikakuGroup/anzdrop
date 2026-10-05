import { XIcon } from "@/components/brand/ShareIcons";
import type { PreviewKind } from "@/lib/preview";
import type { DecryptedFile } from "@/lib/download/decrypt";

export type PreviewState = {
  file: DecryptedFile;
  url: string;
  kind: PreviewKind;
};

type FilePreviewModalProps = {
  preview: PreviewState;
  onClose: () => void;
};

// ブラウザ内プレビュー(画像・音声・動画)のモーダル。Blob URL の寿命は親が管理する。
export default function FilePreviewModal({
  preview,
  onClose,
}: FilePreviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl rounded-lg bg-paper p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <p className="mb-3 truncate pr-10 text-sm font-bold">
          {preview.file.name}
        </p>

        {preview.kind === "video" && (
          <video
            src={preview.url}
            controls
            autoPlay
            className="max-h-[70vh] w-full rounded"
          />
        )}
        {preview.kind === "audio" && (
          <audio src={preview.url} controls autoPlay className="w-full" />
        )}
        {preview.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URLの表示なのでnext/imageの最適化対象外
          <img
            src={preview.url}
            alt={preview.file.name}
            className="max-h-[70vh] w-full rounded object-contain"
          />
        )}
      </div>
    </div>
  );
}
