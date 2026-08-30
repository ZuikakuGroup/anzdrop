import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import DropMark from "@/components/brand/DropMark";

// 利用規約・プライバシーポリシー・特定商取引法に基づく表記の3ページで共有する
// 外枠。見出し・本文の体裁はAboutPageに合わせている。
export default function LegalLayout({
  title,
  description,
  lastUpdated,
  children,
}: {
  title: string;
  description?: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1 px-4 py-12 sm:px-8">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="relative space-y-3 overflow-hidden rounded-lg border border-ink/10 bg-gradient-to-br from-brand/[0.06] to-transparent p-8 sm:p-10">
            <DropMark
              aria-hidden="true"
              className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 text-brand/10"
            />
            <h1 className="relative text-2xl font-black leading-snug tracking-normal sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="relative max-w-md text-sm leading-relaxed text-ink/60">
                {description}
              </p>
            ) : null}
            <p className="relative text-xs text-ink/40">
              最終改定日: {lastUpdated}
            </p>
          </div>

          {children}

          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/50">
            <a href="/legal/terms" className="hover:text-ink hover:underline">
              利用規約
            </a>
            <a href="/legal/privacy" className="hover:text-ink hover:underline">
              プライバシーポリシー
            </a>
            <a
              href="/legal/tokushoho"
              className="hover:text-ink hover:underline"
            >
              特定商取引法に基づく表記
            </a>
          </nav>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
      <h2 className="flex items-center gap-3 text-lg font-black">
        <span
          aria-hidden="true"
          className="h-[1.1em] w-1 shrink-0 rounded-sm bg-brand"
        />
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function LegalParagraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-ink/70">{children}</p>
  );
}

export function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} className="font-bold text-brand hover:underline">
      {children}
    </a>
  );
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/30">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
