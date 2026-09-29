import Image from "next/image";
import Link from "next/link";
import BrandHeader from "@/components/brand/BrandHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import LandingViewTracker from "./LandingViewTracker";

function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex min-h-12 items-center justify-center gap-5 rounded-full bg-brand px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-brand/85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand ${className}`}
    >
      すぐファイルを送る <span aria-hidden="true">↗</span>
    </Link>
  );
}

const STEPS = [
  {
    number: "01",
    title: "ファイルを選ぶ",
    description: "複数のファイルもまとめて選択。アカウント登録やアプリの準備は不要です。",
    image: "/images/loosedrawing/file-transfer.png",
    alt: "フォルダからファイルを取り出すイラスト",
  },
  {
    number: "02",
    title: "暗号化してアップロード",
    description: "ファイルの中身と元のファイル名を、ブラウザ内で暗号化してから送信します。",
    image: "/images/loosedrawing/lock.png",
    alt: "鍵のかかった南京錠のイラスト",
  },
  {
    number: "03",
    title: "共有リンクを渡す",
    description: "送信後に発行されるURLをコピー。QRコードやLINEでも相手に共有できます。",
    image: "/images/loosedrawing/documents.png",
    alt: "資料が入った封筒のイラスト",
  },
];

const FAQS = [
  { question: "アカウント登録やアプリのインストールは必要ですか?", answer: "どちらも不要です。ブラウザからファイルを選ぶだけで利用できます。" },
  { question: "無料でどのくらいのファイルを送れますか?", answer: "無料プランでは、1ファイル最大5GBまで送れます。アップロード数に制限はなく、広告も表示されません。" },
  { question: "ファイルはいつ削除されますか?", answer: "共有時に「1回」「1日」「3日」「7日」から保存期間を選べます。「1回」を選ぶと、ダウンロード後に共有ファイルが削除されます。" },
  { question: "運営者がファイルを見ることはできますか?", answer: "ファイルはブラウザ内で暗号化してから送信されます。通常の共有では復号鍵がURLの#以降に入り、サーバーへ送られません。パスワード保護時も、パスワードはサーバーへ送られません。運営者は中身を復号できません。" },
  { question: "共有URLをなくした場合、あとから復元できますか?", answer: "通常の共有では復号鍵がURLに含まれ、サーバーには保存されません。URLをなくすと運営者でも復元できません。URLは受取人へ安全な方法で共有してください。" },
];

const ILLUSTRATION_CREDITS = [
  { href: "https://loosedrawing.com/illust/1635/", label: "ファイル共有" },
  { href: "https://loosedrawing.com/illust/992/", label: "ネットワーク・クラウド" },
  { href: "https://loosedrawing.com/illust/891/", label: "データ送信" },
  { href: "https://loosedrawing.com/illust/597/", label: "南京錠" },
  { href: "https://loosedrawing.com/illust/934/", label: "封筒に入った資料" },
];

export default function SecureFileSharingLandingPage() {
  return (
    <div className="landing-page-font min-h-screen bg-paper text-ink">
      <LandingViewTracker />

      <header className="bg-paper">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:h-[4.5rem] sm:px-8">
          <Link href="/" aria-label="Anzdrop トップページ" className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
            <BrandHeader />
          </Link>
          <nav aria-label="ページ内メニュー" className="flex shrink-0 items-center gap-6">
            <Link href="/about" className="hidden text-sm font-medium text-ink/65 hover:text-ink md:inline">Anzdropについて</Link>
            <Link href="/pricing" className="hidden text-sm font-medium text-ink/65 hover:text-ink sm:inline">料金プラン</Link>
            <div className="hidden sm:block"><PrimaryCta className="min-h-10 px-4 py-2 text-sm" /></div>
          </nav>
        </div>
      </header>

      <main>
        <section aria-labelledby="hero-heading" className="mx-3 rounded-2xl bg-[#f5f5f3] px-5 sm:mx-5 sm:px-8">
          <div className="mx-auto grid max-w-6xl items-center gap-2 py-12 sm:py-16 lg:min-h-[38rem] lg:grid-cols-[1fr_0.95fr] lg:gap-12 lg:py-20">
            <div className="max-w-[37rem]">
              <p className="text-xs font-bold tracking-wide text-ink/60">登録不要の暗号化ファイル共有</p>
              <h1 id="hero-heading" className="mt-7 text-[clamp(2.25rem,5.4vw,3.75rem)] font-bold leading-[1.25] tracking-tight">
                大切な<br className="sm:hidden" />ファイルを、<br />
                <span className="text-brand">安全に</span>送る。
              </h1>
              <p className="mt-7 max-w-[29rem] text-sm leading-7 text-ink/70 sm:text-base sm:leading-8">
                ブラウザで暗号化してからアップロード。登録せずに、発行されたリンクでファイルを共有できます。
              </p>
              <div className="mt-8 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                <PrimaryCta className="w-full sm:w-auto" />
                <Link href="/about" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink/70 hover:text-brand-text">
                  安全性について <span aria-hidden="true">→</span>
                </Link>
              </div>
              <p className="mt-5 text-xs text-ink/55">無料プランは1ファイル最大5GB</p>
            </div>
            <Image
              src="/images/loosedrawing/file-sharing.png"
              alt="ファイルをオンラインで共有する2人のイラスト"
              width={799}
              height={799}
              preload
              className="mx-auto h-48 w-full max-w-[31rem] object-cover object-center sm:h-80 lg:h-[28rem] lg:justify-self-end"
            />
          </div>
        </section>

        <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-10 gap-y-3 border-b border-ink/10 px-5 py-6 text-xs font-medium text-ink/65 sm:px-8 sm:text-sm">
          <span><span aria-hidden="true" className="mr-2 text-brand-text">✓</span>アカウント登録なし</span>
          <span><span aria-hidden="true" className="mr-2 text-brand-text">✓</span>ブラウザ内でE2E暗号化</span>
          <span><span aria-hidden="true" className="mr-2 text-brand-text">✓</span>広告なしの無料プラン</span>
        </div>

        <section aria-labelledby="about-heading" className="px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-24">
            <div className="max-w-lg">
              <p className="text-base font-bold text-brand-text">Anzdropについて</p>
              <h2 id="about-heading" className="mt-5 text-3xl font-bold leading-[1.4] tracking-tight sm:text-[2.4rem]">
                送る人も、<br className="sm:hidden" />受け取る人も、<br />
                ブラウザだけ。
              </h2>
              <p className="mt-6 text-sm leading-8 text-ink/70">
                送り手はファイルを選んでアップロード。受け取る人は共有リンクを開くだけ。アプリのインストールもアカウント作成も必要ありません。
              </p>
              <p className="mt-4 text-sm leading-8 text-ink/70">
                ファイルの保存期間は、1回・1日・3日・7日から選べます。
              </p>
              <Link href="/about" className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink hover:text-brand-text">
                Anzdropの仕組みを見る <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="rounded-xl bg-[#f5f5f3] px-5">
              <Image src="/images/loosedrawing/network-cloud.png" alt="パソコンとスマートフォンからつながる人々のイラスト" width={799} height={799} className="mx-auto h-72 w-full max-w-md object-cover object-center sm:h-96" />
            </div>
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="mx-3 rounded-2xl bg-[#f5f5f3] px-5 py-20 sm:mx-5 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-base font-bold text-brand-text">使い方</p>
                <h2 id="steps-heading" className="mt-4 text-3xl font-bold leading-[1.4] tracking-tight sm:text-[2.25rem]">ファイルを選んで、リンクを渡す。</h2>
              </div>
              <p className="max-w-xs text-sm leading-7 text-ink/65">準備は不要です。ファイルを選ぶところから始められます。</p>
            </div>
            <ol className="mt-10 space-y-3">
              {STEPS.map((step) => (
                <li key={step.number} className="grid items-center gap-4 rounded-xl bg-paper p-4 sm:grid-cols-[11rem_1fr] sm:gap-8 sm:p-5 lg:grid-cols-[13rem_1fr]">
                  <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg bg-[#f5f5f3] sm:h-40">
                    <Image src={step.image} alt={step.alt} width={799} height={799} className="h-full w-full scale-[1.25] object-contain" />
                  </div>
                  <div className="py-1 sm:py-3">
                    <p className="text-xs font-bold text-brand-text">{step.number} / 03</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{step.title}</h3>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-ink/65">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="privacy-heading" className="mt-20 bg-[#242424] px-5 py-20 text-white sm:mt-28 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
            <div>
              <p className="text-base font-bold text-brand">暗号化について</p>
              <h2 id="privacy-heading" className="mt-5 text-3xl font-bold leading-[1.4] tracking-tight sm:text-[2.7rem]">
                鍵は、サーバーに<br />渡さない。
              </h2>
              <p className="mt-6 max-w-md text-sm leading-8 text-white/70">
                ファイルは送信前に暗号化。通常の共有では、復号鍵を共有URLの「#」以降に含めます。この部分はHTTPリクエストでサーバーへ送られません。
              </p>
              <Link href="/about" className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-white hover:text-brand">
                暗号化の仕組みを詳しく見る <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="self-center border-t border-white/20 pt-6 lg:border-t-0 lg:pt-0">
              <p className="text-xs font-bold text-white/50">通常の共有URLの構造（パスワード未設定時）</p>
              <div className="mt-6 flex flex-wrap gap-2 font-mono text-base sm:text-xl">
                <span className="rounded bg-white/10 px-4 py-4">…/d/共有ID</span>
                <span className="rounded bg-brand px-4 py-4 font-bold text-ink">#復号鍵</span>
              </div>
              <div className="mt-7 grid gap-5 border-t border-white/20 pt-6 text-sm leading-7 text-white/70 sm:grid-cols-2">
                <p><strong className="block text-white">共有ID</strong>サーバーに届く公開の識別子。</p>
                <p><strong className="block text-white">#以降の復号鍵</strong>URLを開くブラウザで使われ、サーバーには届きません。</p>
              </div>
              <p className="mt-6 text-xs leading-6 text-white/50">受取人にはURL全体を共有してください。URLをなくすと運営者も復元できません。</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="plan-heading" className="px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div><h2 id="plan-heading" className="text-3xl font-bold leading-[1.4] tracking-tight sm:text-[2.15rem]">登録なしで、ここまで使えます。</h2></div>
              <Link href="/pricing" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink hover:text-brand-text">料金プランを見る <span aria-hidden="true">→</span></Link>
            </div>
            <div className="mt-10 grid gap-6 rounded-xl border border-ink/10 bg-[#f5f5f3] p-6 sm:p-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-center lg:gap-12">
              <div>
                <p className="text-sm font-bold">無料プラン</p>
                <p className="mt-2 text-6xl font-bold tracking-tight">¥0</p>
                <p className="mt-3 text-xs text-ink/60">広告も表示されません。</p>
              </div>
              <dl className="border-t border-ink/15 lg:border-t-0">
                <div className="flex items-baseline justify-between gap-4 border-b border-ink/15 py-4"><dt className="text-sm">1ファイルの最大容量</dt><dd className="text-xl font-bold">5GB</dd></div>
                <div className="flex items-baseline justify-between gap-4 border-b border-ink/15 py-4"><dt className="text-sm">保存期間</dt><dd className="text-sm font-bold">1回・1日・3日・7日</dd></div>
                <div className="flex items-baseline justify-between gap-4 py-4"><dt className="text-sm">アップロード数</dt><dd className="text-sm font-bold">無制限</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-ink/10 px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24">
            <div><h2 id="faq-heading" className="text-3xl font-bold tracking-tight sm:text-[2rem]">よくある質問</h2></div>
            <div className="divide-y divide-ink/10 border-y border-ink/10">
              {FAQS.map((faq) => (
                <details key={faq.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold marker:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
                    {faq.question}<span aria-hidden="true" className="shrink-0 text-xl font-normal text-brand-text transition-transform group-open:rotate-45">＋</span>
                  </summary>
                  <p className="pr-8 pt-3 text-sm leading-7 text-ink/65">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-ink/10 bg-paper px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div><h2 className="text-3xl font-bold leading-[1.4] tracking-tight sm:text-[2.7rem]">次に送るファイルから、<br />Anzdropで。</h2></div>
            <PrimaryCta className="w-full shrink-0 sm:w-auto" />
          </div>
        </section>
      </main>

      <div className="bg-paper px-5 py-5 text-center text-[11px] text-ink/50 sm:px-8">
        イラスト: Loose Drawing /
        {ILLUSTRATION_CREDITS.map((credit, index) => (
          <span key={credit.href}>
            {index > 0 ? "・" : " "}
            <a href={credit.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">{credit.label}</a>
          </span>
        ))}
      </div>
      <SiteFooter />
    </div>
  );
}
