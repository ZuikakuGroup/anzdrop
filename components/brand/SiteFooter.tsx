import BrandHeader from "./BrandHeader";
import DropMark from "./DropMark";

type SiteFooterProps = {
  reportShareId?: string;
};

const linkClassName =
  "rounded-sm text-ink/60 transition-colors hover:text-ink hover:underline focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default function SiteFooter({ reportShareId }: SiteFooterProps) {
  const reportHref = reportShareId
    ? `/report?shareId=${encodeURIComponent(reportShareId)}`
    : "/report";

  const linkGroups = [
    {
      id: "legal",
      heading: "規約・法的情報",
      links: [
        { href: "/legal/terms", label: "利用規約" },
        { href: "/legal/privacy", label: "プライバシーポリシー" },
        { href: "/legal/tokushoho", label: "特定商取引法に基づく表記" },
      ],
    },
    {
      id: "support",
      heading: "サポート",
      links: [
        { href: reportHref, label: "問題を報告" },
        { href: "/contact", label: "お問い合わせ" },
      ],
    },
  ];

  return (
    <footer className="relative shrink-0 overflow-hidden border-t border-ink/10 bg-paper px-6 py-10 sm:px-8">
      <DropMark className="pointer-events-none absolute -bottom-10 -right-6 h-40 w-40 text-brand/[0.06]" />

      <div className="relative mx-auto flex max-w-4xl flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="space-y-3">
          <BrandHeader />
          <p className="max-w-xs text-xs leading-relaxed text-ink/60">
            登録不要・エンドツーエンド暗号化の匿名ファイル共有。
          </p>
          <p className="text-[11px] text-ink/50">&copy; Anzdrop</p>
        </div>

        <nav
          aria-label="フッター"
          className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-14 md:gap-16"
        >
          {linkGroups.map((group) => {
            const headingId = `site-footer-${group.id}`;

            return (
              <div key={group.id} className="space-y-2.5">
                <p
                  id={headingId}
                  className="text-[11px] font-bold tracking-wide text-ink/50"
                >
                  {group.heading}
                </p>
                <ul
                  aria-labelledby={headingId}
                  className="space-y-2 text-xs"
                >
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className={linkClassName}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
    </footer>
  );
}
