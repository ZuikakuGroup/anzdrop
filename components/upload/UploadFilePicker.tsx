import { formatBytes } from "@/lib/format";
import type { PendingFile } from "@/lib/upload/dragDropFiles";

type UploadFilePickerProps = {
  fileInputId: string;
  files: PendingFile[];
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

// 未選択時の誘導と、選択済みファイル一覧の表示。選択イベントは親へ渡す。
export default function UploadFilePicker({
  fileInputId,
  files,
  onFileChange,
}: UploadFilePickerProps) {
  return (
    <label
      htmlFor={fileInputId}
      className={
        files.length === 0
          ? "flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center transition-colors hover:bg-ink/[0.03]"
          : "anz-scroll block h-40 cursor-pointer overflow-y-auto rounded border-2 border-ink p-2 transition-colors hover:bg-ink/[0.03]"
      }
    >
      {files.length === 0 ? (
        <>
          <span className="text-base font-black">
            ファイルを選択
          </span>
          <span className="text-xs font-bold text-ink/50">
            クリックまたはドラッグ&ドロップで選択<br />フォルダはドラッグでアップロード
          </span>
        </>
      ) : (
        <ul className="divide-y divide-ink/10 text-[13px]">
          {files.map((pendingFile) => (
            <li
              key={`${pendingFile.path}-${pendingFile.file.lastModified}`}
              className="flex items-center justify-between gap-4 px-2 py-2"
            >
              <span className="truncate">{pendingFile.path}</span>
              <span className="shrink-0 font-bold text-ink/40">
                {formatBytes(pendingFile.file.size)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        id={fileInputId}
        type="file"
        multiple
        onChange={onFileChange}
        className="sr-only"
      />
    </label>
  );
}
