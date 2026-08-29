type AdminNavProps = {
  active: "reports" | "contacts";
};

const ADMIN_NAV_ITEMS: { key: AdminNavProps["active"]; href: string; label: string }[] = [
  { key: "reports", href: "/admin", label: "通報" },
  { key: "contacts", href: "/admin/contacts", label: "お問い合わせ" },
];

export default function AdminNav({ active }: AdminNavProps) {
  return (
    <div className="flex gap-2">
      {ADMIN_NAV_ITEMS.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
            active === item.key
              ? "bg-ink text-paper"
              : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
          }`}
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}
