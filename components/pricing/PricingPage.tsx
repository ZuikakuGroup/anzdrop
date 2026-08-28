import Link from "next/link";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import { CheckIcon, XIcon } from "@/components/brand/ShareIcons";

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1 px-4 py-12 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 space-y-2 text-center">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              料金プラン
            </h1>
            <p className="text-sm text-ink/50">
              アカウントIDとパスワードだけで、必要な分だけご利用いただけます。
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col rounded-lg border border-ink/10 bg-paper p-8">
              <h2 className="text-lg font-black">Free</h2>
              <p className="mt-1 text-sm text-ink/50">
                無料で今すぐ使い始められます。
              </p>

              <p className="mt-4 text-3xl font-black">¥0
                <span className="text-sm font-bold text-ink/50"> / 月</span>
              </p>
              <p className="mt-1 text-[11px] text-ink/40">
                ログイン不要で使用可能です。
              </p>
              <p className="mt-1 text-[11px] text-ink/40"></p>

              <div className="mt-4 grid grid-cols-2 gap-3 border-y border-ink/10 py-4">
                <div>
                  <p className="text-xl font-black">5GB</p>
                  <p className="text-[11px] text-ink/50">最大ファイルサイズ</p>
                </div>
                <div>
                  <p className="text-xl font-black">7日</p>
                  <p className="text-[11px] text-ink/50">最大保存期間</p>
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-ink/70">
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  広告なし
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  ファイルアップロード数無制限
                </li>
                <li className="flex items-center gap-2 text-ink/40">
                  <XIcon className="h-4 w-4 shrink-0 text-ink/30" />
                  Turnstile認証をスキップ
                </li>
                <li className="flex items-center gap-2 text-ink/40">
                  <XIcon className="h-4 w-4 shrink-0 text-ink/30" />
                  高速アップロード
                </li>
                <li className="flex items-center gap-2 text-ink/40">
                  <XIcon className="h-4 w-4 shrink-0 text-ink/30" />
                  ブラウザ内プレビュー
                </li>
              </ul>

              <Link
                href="/"
                className="mt-8 block w-full rounded border-2 border-ink px-4 py-3 text-center text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03]"
              >
                始める
              </Link>
            </div>

            <div className="flex flex-col rounded-lg border border-ink/10 bg-paper p-8">
              <h2 className="text-lg font-black">Standard</h2>
              <p className="mt-1 text-sm text-ink/50">
                近日公開予定の中間プランです。
              </p>
              <p className="mt-4 text-3xl font-black">
                ¥250
                <span className="text-sm font-bold text-ink/50"> / 月</span>
              </p>
              <p className="mt-1 text-[11px] text-ink/40">
                ビットコイン決済の場合、為替レートにより変動します。
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 border-y border-ink/10 py-4">
                <div>
                  <p className="text-xl font-black">20GB</p>
                  <p className="text-[11px] text-ink/50">最大ファイルサイズ</p>
                </div>
                <div>
                  <p className="text-xl font-black">15日</p>
                  <p className="text-[11px] text-ink/50">最大保存期間</p>
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-ink/70">
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  広告なし
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  ファイルアップロード数無制限
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  Turnstile認証をスキップ
                </li>
                <li className="flex items-center gap-2 text-ink/40">
                  <XIcon className="h-4 w-4 shrink-0 text-ink/30" />
                  高速アップロード
                </li>
                <li className="flex items-center gap-2 text-ink/40">
                  <XIcon className="h-4 w-4 shrink-0 text-ink/30" />
                  ブラウザ内プレビュー
                </li>
              </ul>

              <span className="mt-8 block w-full rounded border-2 border-ink/20 px-4 py-3 text-center text-sm font-black tracking-wider text-ink/30">
                準備中
              </span>
            </div>

            <div className="flex flex-col rounded-lg border-2 border-brand bg-paper p-8">
              <h2 className="text-lg font-black text-brand">Premium</h2>
              <p className="mt-1 text-sm text-ink/50">
                大きなファイルや長期保存に。
              </p>
              <p className="mt-4 text-3xl font-black">
                ¥450
                <span className="text-sm font-bold text-ink/50"> / 月</span>
              </p>
              <p className="mt-1 text-[11px] text-ink/40">
                ビットコイン決済の場合、為替レートにより変動します。
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 border-y border-brand/20 py-4">
                <div>
                  <p className="text-xl font-black text-brand">50GB</p>
                  <p className="text-[11px] text-ink/50">最大ファイルサイズ</p>
                </div>
                <div>
                  <p className="text-xl font-black text-brand">30日</p>
                  <p className="text-[11px] text-ink/50">最大保存期間</p>
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-ink/70">
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  広告なし
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  ファイルアップロード数無制限
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  Turnstile認証をスキップ
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  高速アップロード
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
                  ブラウザ内プレビュー
                </li>
              </ul>

              <a
                href="/mypage/billing"
                className="mt-8 block w-full rounded bg-brand px-4 py-3 text-center text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
              >
                始める
              </a>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-ink/40">
            各プランの内容・価格は今後変更される場合があります。
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
