import {
  type AdminStatusFilter,
} from "@/lib/admin/statusFilter";

export type { AdminStatusFilter };

const STATUS_TABS: { value: AdminStatusFilter; label: string }[] = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "all", label: "すべて" },
];

type StatusFilterTabsProps = {
  status: AdminStatusFilter;
  onChange: (status: AdminStatusFilter) => void;
};

// 通報・お問い合わせ管理で共通の「未対応 / 対応済み / すべて」タブ。
export default function StatusFilterTabs({
  status,
  onChange,
}: StatusFilterTabsProps) {
  return (
    <div className="flex gap-2">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
            status === tab.value
              ? "bg-ink text-paper"
              : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
