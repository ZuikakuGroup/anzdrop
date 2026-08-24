import DropMark from "./DropMark";

export default function BrandHeader() {
  return (
    <div className="flex items-center gap-2">
      <DropMark className="h-4 w-4 text-brand anz-drop-enter" />
      <span className="text-sm font-black tracking-tight">
        Anzdrop
      </span>
    </div>
  );
}
