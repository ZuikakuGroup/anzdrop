type SiteFooterProps = {
  reportShareId?: string;
};

export default function SiteFooter({ reportShareId }: SiteFooterProps) {
  const reportHref = reportShareId
    ? `/report?shareId=${encodeURIComponent(reportShareId)}`
    : "/report";

  return (
    <footer className="flex h-12 shrink-0 items-center justify-center gap-3 text-[11px] text-ink/40">
      <p>&copy; Anzdrop</p>
      <span aria-hidden="true">·</span>
      <a href={reportHref} className="hover:text-ink/70 hover:underline">
        問題を報告
      </a>
      <span aria-hidden="true">·</span>
      <a href="/contact" className="hover:text-ink/70 hover:underline">
        お問い合わせ
      </a>
    </footer>
  );
}
