import { XIcon } from "@/components/brand/ShareIcons";
import { NON_DISMISSIBLE_ERRORS } from "@/lib/download/errors";

type DownloadErrorPanelProps = {
  error: string;
  onDismiss: () => void;
};

// 読み込み・ダウンロード失敗時のエラー表示。閉じられない文言は閉じボタンを出さない。
export default function DownloadErrorPanel({
  error,
  onDismiss,
}: DownloadErrorPanelProps) {
  return (
    <div className="relative flex h-40 flex-col items-center justify-center gap-2 rounded border-2 border-brand p-6 text-center">
      {!NON_DISMISSIBLE_ERRORS.has(error) && (
        <button
          onClick={onDismiss}
          aria-label="閉じる"
          title="閉じる"
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
      <p className="text-sm font-bold text-brand">{error}</p>
    </div>
  );
}
