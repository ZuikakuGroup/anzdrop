type SiteFooterProps = {
  reportShareId?: string;
};

export default function SiteFooter({ reportShareId }: SiteFooterProps) {
  const reportHref = reportShareId
    ? `/report?shareId=${encodeURIComponent(reportShareId)}`
    : "/report";

  return (
    <footer className="shrink-0 px-4 py-4 text-[11px] text-ink/40">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        <a href="/legal/terms" className="hover:text-ink/70 hover:underline">
          利用規約
        </a>
        <span aria-hidden="true">·</span>
        <a href="/legal/privacy" className="hover:text-ink/70 hover:underline">
          プライバシーポリシー
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="/legal/tokushoho"
          className="hover:text-ink/70 hover:underline"
        >
          特定商取引法に基づく表記
        </a>
        <span aria-hidden="true">·</span>
        <a href={reportHref} className="hover:text-ink/70 hover:underline">
          問題を報告
        </a>
        <span aria-hidden="true">·</span>
        <a href="/contact" className="hover:text-ink/70 hover:underline">
          お問い合わせ
        </a>
      </div>
    </footer>
  );
}
