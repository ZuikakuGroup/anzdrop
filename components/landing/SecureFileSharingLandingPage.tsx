import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import { ArrowRightIcon } from "@/components/brand/ShareIcons";
import FaqAccordion from "@/components/about/FaqAccordion";
import LandingViewTracker from "./LandingViewTracker";

function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <a
      href="/"
      className={"inline-flex min-h-12 items-center justify-center gap-3 rounded bg-brand-action px-6 py-3 text-sm font-black text-paper transition-colors hover:bg-brand-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand " + className}
    >
      無料でファイルを送る <ArrowRightIcon className="h-4 w-4 shrink-0" />
    </a>
  );
}

const STEPS = [
  { number: "01", title: "ファイルを選ぶ", description: "送りたいファイルを選択。アカウント登録やアプリの準備は不要です。" },
  { number: "02", title: "ブラウザで暗号化して送る", description: "ファイルの中身と元のファイル名を、送信前にブラウザ内で暗号化します。" },
  { number: "03", title: "リンクを相手に渡す", description: "発行された共有URLをコピーして、受け取る人に渡します。" },
];

const FAQS = [
  { question: "アカウント登録やアプリのインストールは必要ですか?", answer: "どちらも不要です。ブラウザからファイルを選ぶだけで利用できます。" },
  { question: "無料でどのくらいのファイルを送れますか?", answer: "無料プランでは、1ファイル最大5GBまで送れます。アップロード数に制限はなく、広告も表示されません。" },
  { question: "ファイルはいつ削除されますか?", answer: "共有時に「1回」「1日」「3日」「7日」から保存期間を選べます。「1回」を選ぶと、ダウンロード後に共有ファイルが削除されます。" },
  { question: "運営者がファイルを見ることはできますか?", answer: "ファイルはブラウザ内で暗号化してから送信されます。通常の共有では復号鍵がURLの#以降に入り、サーバーへ送られません。パスワード保護時も、パスワードはサーバーへ送られません。運営者は中身を復号できません。" },
  { question: "共有URLをなくした場合、あとから復元できますか?", answer: "通常の共有では復号鍵がURLに含まれ、サーバーには保存されません。URLをなくすと運営者でも復元できません。URLは受取人へ安全な方法で共有してください。" },
];

export default function SecureFileSharingLandingPage({ showChrome = true, nativeFaq = false }: { showChrome?: boolean; nativeFaq?: boolean } = {}) {
  return (
    <div className={showChrome ? "landing-page-font min-h-screen bg-paper text-ink" : "flex-1"}>
      {showChrome && <LandingViewTracker />}
      {showChrome && <SiteHeader />}

      <main>
        <section aria-labelledby="hero-heading" className="px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1.1fr_0.9fr] md:gap-8 lg:gap-16">
            <div className="max-w-[39rem]">
              <p className="text-sm font-bold text-brand-text">登録不要の暗号化ファイル共有</p>
              <h1 id="hero-heading" className="mt-5 text-[clamp(2.35rem,5vw,4.25rem)] font-extrabold leading-[1.22] tracking-tight">
                ファイルは、<br />送る前に<span className="text-brand">暗号化。</span>
              </h1>
              <p className="mt-6 max-w-[32rem] text-base leading-8 text-ink/75 sm:text-lg sm:leading-9">
                ファイルを選ぶだけで、ブラウザが中身とファイル名を暗号化。発行されたリンクを相手に渡せます。
              </p>
              <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <PrimaryCta className="w-full sm:w-auto" />
                <a href="/about" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink/70 transition-colors hover:text-brand-text">
                  安全性について <ArrowRightIcon className="h-4 w-4 shrink-0" />
                </a>
              </div>
              <p className="mt-4 text-sm text-ink/60">無料プランは1ファイル最大5GB・広告なし</p>
            </div>
            <div className="flex items-center justify-center overflow-hidden rounded-lg bg-ink/[0.03] px-4 py-3 sm:px-8 sm:py-6 md:min-h-[23rem]">
              <img src="/images/loosedrawing/file-sharing.png" alt="2人の間でファイルを共有するイラスト" width={799} height={799} loading="eager" fetchPriority="high" sizes="(min-width: 1024px) 440px, (min-width: 768px) 360px, (min-width: 640px) 480px, 340px" className="h-52 w-full max-w-[27rem] scale-[1.15] object-contain sm:h-72 md:h-80" />
            </div>
          </div>
        </section>

        <div className="border-y border-ink/10 px-5 sm:px-8">
          <ul className="mx-auto grid max-w-6xl text-sm sm:grid-cols-3 sm:divide-x sm:divide-ink/10">
            <li className="flex items-center gap-3 py-4 sm:pr-6"><span className="font-mono text-xs text-brand-text">01</span><span>アカウント登録なし</span></li>
            <li className="flex items-center gap-3 border-t border-ink/10 py-4 sm:border-t-0 sm:px-6"><span className="font-mono text-xs text-brand-text">02</span><span>送信前にブラウザで暗号化</span></li>
            <li className="flex items-center gap-3 border-t border-ink/10 py-4 sm:border-t-0 sm:pl-6"><span className="font-mono text-xs text-brand-text">03</span><span>保存期間を選べる</span></li>
          </ul>
        </div>

        <section aria-labelledby="steps-heading" className="px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-brand-text">使い方</p>
              <h2 id="steps-heading" className="mt-3 text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">選んで、送って、リンクを渡す。</h2>
              <p className="mt-4 text-base leading-8 text-ink/70">受け取る人も、共有リンクをブラウザで開くだけです。</p>
            </div>
            <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
              {STEPS.map((step) => (
                <li key={step.number} className="rounded-lg border border-ink/10 border-t-2 border-t-brand bg-paper p-6 sm:p-8">
                  <span className="font-mono text-sm font-bold text-brand-text">{step.number}</span>
                  <h3 className="mt-4 text-lg font-bold sm:text-xl">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-ink/70">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="privacy-heading" className="bg-ink/[0.03] px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-12 lg:gap-20">
            <div>
              <p className="text-sm font-bold text-brand-text">暗号化の仕組み</p>
              <h2 id="privacy-heading" className="mt-3 text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">復号鍵は、サーバーに送らない。</h2>
              <p className="mt-5 text-base leading-8 text-ink/75">
                ファイルは送信前にブラウザ内で暗号化します。通常の共有の場合、復号鍵は共有URLの「#」以降に入り、この部分はサーバーへ送られません。
              </p>
              <a href="/about" className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink transition-colors hover:text-brand-text">暗号化の仕組みを詳しく見る <ArrowRightIcon className="h-4 w-4 shrink-0" /></a>
            </div>
            <div className="border border-ink/10 bg-paper p-5 sm:p-8">
              <p className="text-xs font-bold text-ink/60">通常の共有URL（パスワード未設定時）</p>
              <div className="mt-5 flex flex-wrap gap-2 break-all font-mono text-sm sm:text-base">
                <span className="rounded bg-ink/[0.04] px-3 py-3">…/d/共有ID</span>
                <span className="rounded bg-brand/[0.08] px-3 py-3 font-bold text-brand-text">#復号鍵</span>
              </div>
              <dl className="mt-6 grid gap-5 border-t border-ink/10 pt-5 text-sm leading-6 sm:grid-cols-2">
                <div><dt className="font-bold">共有ID</dt><dd className="mt-1 text-ink/65">サーバーに届く公開の識別子。</dd></div>
                <div><dt className="font-bold">#以降の復号鍵</dt><dd className="mt-1 text-ink/65">受取人のブラウザで使われ、サーバーには届きません。</dd></div>
              </dl>
              <p className="mt-6 border-t border-ink/10 pt-5 text-xs leading-6 text-ink/60">受取人にはURL全体を共有してください。URLをなくすと運営者も復元できません。</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="plan-heading" className="px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="text-sm font-bold text-brand-text">無料プラン</p><h2 id="plan-heading" className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">登録なしで、無料から。</h2></div>
              <a href="/pricing" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-ink transition-colors hover:text-brand-text">料金プランを見る <ArrowRightIcon className="h-4 w-4 shrink-0" /></a>
            </div>
            <dl className="mt-10 grid border-y border-ink/15 sm:grid-cols-3 sm:divide-x sm:divide-ink/15">
              <div className="flex items-baseline justify-between gap-5 py-5 sm:block sm:pr-8"><dt className="text-sm text-ink/65">1ファイルの最大容量</dt><dd className="text-2xl font-bold">5GB</dd></div>
              <div className="flex items-baseline justify-between gap-5 border-t border-ink/15 py-5 sm:block sm:border-t-0 sm:px-8"><dt className="text-sm text-ink/65">保存期間</dt><dd className="text-base font-bold sm:mt-2">1回・1日・3日・7日</dd></div>
              <div className="flex items-baseline justify-between gap-5 border-t border-ink/15 py-5 sm:block sm:border-t-0 sm:pl-8"><dt className="text-sm text-ink/65">アップロード数</dt><dd className="text-2xl font-bold">無制限</dd></div>
            </dl>
            <p className="mt-4 text-sm text-ink/60">無料プランは広告も表示されません。</p>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-ink/10 px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <h2 id="faq-heading" className="text-3xl font-extrabold tracking-tight sm:text-4xl">よくある質問</h2>
            <FaqAccordion
              native={nativeFaq}
              items={FAQS}
              marker="plus"
              className="divide-y divide-ink/15 border-y border-ink/15"
            />
          </div>
        </section>

        <section className="border-t border-ink/10 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-7 md:flex-row md:items-center">
            <div><h2 className="text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">準備ができたら、ファイルを選ぶだけ。</h2><p className="mt-3 text-sm text-ink/65">登録なしで、そのまま始められます。</p></div>
            <PrimaryCta className="w-full shrink-0 sm:w-auto" />
          </div>
        </section>
      </main>

      {showChrome && <SiteFooter />}
    </div>
  );
}
