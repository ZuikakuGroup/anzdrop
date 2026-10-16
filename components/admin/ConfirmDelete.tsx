import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDelete({ children, pending, onConfirm, onCancel }: Props) {
  return (
    <div className="flex items-center gap-2 rounded border-2 border-ink/20 px-2 py-1">
      <span className="text-xs font-bold text-ink/70">{children}</span>
      <button
        onClick={onConfirm}
        disabled={pending}
        className="rounded bg-ink px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-ink/90 disabled:opacity-40"
      >
        {pending ? "削除中..." : "削除する"}
      </button>
      <button
        onClick={onCancel}
        disabled={pending}
        className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
      >
        キャンセル
      </button>
    </div>
  );
}
