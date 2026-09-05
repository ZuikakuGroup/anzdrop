import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import DropMark from "@/components/brand/DropMark";
import { ArrowUpRightIcon } from "@/components/brand/ShareIcons";
import FaqAccordion from "@/components/about/FaqAccordion";

const FAQ_ITEMS: { question: string; answer: React.ReactNode }[] = [
  {
    question: "アカウント登録は必要ですか?",
    answer:
      "いいえ、登録なしで匿名のままファイルを共有できます。有料プランを利用する場合のみ、アカウント登録が必要です。登録をしてもファイルとユーザーは紐づきません。",
  },
  {
    question: "アップロードできるファイルサイズは?",
    answer: (
      <>
        無料プランは5GBまでです。有料プランでさらに大きなファイルを送れます。詳しくは
        {" "}
        <a href="/pricing" className="font-bold text-brand hover:underline">
          料金プランのページ
        </a>
        をご覧ください。
      </>
    ),
  },
  {
    question: "保存期間はどのくらいですか?",
    answer:
      "「1回(ダウンロードされ次第削除)」「1日」「3日」「7日」から選べます(有料プランでは15日・30日も選択可能)。期限が来た共有は自動的に削除されます。",
  },
  {
    question: "パスワードやリカバリーコードを忘れてしまいました",
    answer:
      "サーバー側にはパスワードの平文もファイルの復号鍵も保存していないため、忘れてしまうと運営側でも復元できません。表示された際に必ず安全な場所へ保管してください。",
  },
  {
    question: "不適切なファイルを見つけたら?",
    answer: (
      <>
        各共有ページから通報できます。違法なコンテンツについては最優先で対応します。著作権など権利者ご本人からの申し立ては
        {" "}
        <a href="/report/rights" className="font-bold text-brand hover:underline">
          専用フォーム
        </a>
        からお願いします。
      </>
    ),
  },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-black">
      <span
        aria-hidden="true"
        className="h-[1.1em] w-1 shrink-0 rounded-sm bg-brand"
      />
      {children}
    </h2>
  );
}

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="min-h-[calc(100svh-4rem)] flex-1 px-4 py-12 sm:px-8">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="relative space-y-3 overflow-hidden rounded-lg border border-ink/10 bg-gradient-to-br from-brand/[0.06] to-transparent p-8 sm:p-10">
            <DropMark
              aria-hidden="true"
              className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 text-brand/10"
            />
            <h1 className="relative text-2xl font-black leading-snug tracking-normal sm:text-3xl">
              Anzdropとは
            </h1>
            <p className="relative max-w-md text-sm leading-relaxed text-ink/60">
              アカウントIDとパスワードだけで、必要な分だけご利用いただけます。
            </p>
          </div>

          <section className="space-y-3 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
            <SectionHeading>理念・非営利であること</SectionHeading>
            <p className="text-sm leading-relaxed text-ink/70">
              Anzdropは非営利の方針で運営しています。<br />無料プランは今後も無料のまま提供を続け、広告は一切表示しません。有料プランは、利益を追求するためではなく、サービスを維持するためのサーバー代などの実費をまかなうことを目的としています。
            </p>
            <p className="text-sm leading-relaxed text-ink/70">
              誰でも登録なしにすぐ使える匿名のファイル共有を、長く提供し続けることを目指しています。
            </p>
          </section>

          <section className="space-y-3 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
            <SectionHeading>E2E暗号化の仕組み</SectionHeading>
            <p className="text-sm leading-relaxed text-ink/70">
              ファイルは送信される前に、ブラウザの中で強力な暗号方式で自動的に鍵をかけられます。<br />運営者を含め、サーバー側がファイルの中身をのぞき見ることは一度もできません。
            </p>
            <p className="text-sm leading-relaxed text-ink/70">
              URLには復号のための鍵が含まれていますが、この部分はサーバーへ送信されません。<br />そのためアクセスログなどにも残らず、URLを知っている人以外が中身を見ることはできません。
            </p>
            <p className="text-sm leading-relaxed text-ink/70">
              また、任意でパスワードを設定すると、この鍵をさらにもう一段守ることができます。<br />設定したパスワードそのものもサーバーには送信されません。
            </p>
          </section>

          <section className="space-y-3 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
            <SectionHeading>オープンソースで開発しています</SectionHeading>
            <p className="text-sm leading-relaxed text-ink/70">
              Anzdropの実装はすべてGitHub上で公開しています。<br />誰でもコードを確認したり、開発に参加したりできます。
            </p>
            <a
              href="https://github.com/ZuikakuGroup/anzdrop"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border-2 border-ink px-4 py-2.5 text-sm font-medium tracking-wider text-ink transition-colors hover:bg-ink/[0.03]"
            >
              開発に参加する
              <ArrowUpRightIcon className="h-4 w-4" />
            </a>
          </section>

          <section className="space-y-4 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
            <SectionHeading>よくある質問</SectionHeading>
            <FaqAccordion items={FAQ_ITEMS} />
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
