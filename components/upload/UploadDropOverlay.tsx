import DropMark from "@/components/brand/DropMark";

// ドラッグ中に画面全体を覆うドロップ誘導。uploadForm から見た目だけ分離する。
export default function UploadDropOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-paper/90 backdrop-blur-xs">
      <DropMark className="h-14 w-14 text-brand" />
      <p className="text-lg font-black">ここにドロップ</p>
    </div>
  );
}
