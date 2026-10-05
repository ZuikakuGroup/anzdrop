import Spinner from "@/components/brand/Spinner";

// 共有メタデータの読み込み中表示。
export default function DownloadLoading() {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center">
      <Spinner className="mb-1 h-6 w-6 text-brand" />
      <span className="text-xs font-bold text-ink/50">
        読み込み中...
      </span>
    </div>
  );
}
