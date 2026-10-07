import DropMark from "./DropMark";

export default function BrandHeader() {
  return (
    <div className="flex items-center gap-2">
      <DropMark className="h-6 w-6 text-brand anz-drop-enter" />
      <span className="anz-brand-font text-base font-bold tracking-tight">
        Anzdrop
      </span>
    </div>
  );
}
