import { Quicksand } from "next/font/google";
import DropMark from "./DropMark";

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: "700",
});

export default function BrandHeader() {
  return (
    <div className="flex items-center gap-2">
      <DropMark className="h-6 w-6 text-brand anz-drop-enter" />
      <span className={`${quicksand.className} text-base font-bold tracking-tight`}>
        Anzdrop
      </span>
    </div>
  );
}
