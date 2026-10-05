import Spinner from "@/components/brand/Spinner";

type UploadProgressProps = {
  progress: number;
};

// アップロード中の進捗表示。% とバーの見た目だけを担当する。
export default function UploadProgress({ progress }: UploadProgressProps) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-3 rounded border-2 border-ink p-6 text-center">
      <Spinner className="h-6 w-6 text-brand" />
      <span className="text-xs font-bold text-ink/50">
        アップロード中... {progress}%
      </span>
      <div className="h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-brand transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
