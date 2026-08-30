import Link from "next/link";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import DropMark from "@/components/brand/DropMark";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <DropMark className="h-8 w-8 text-brand" />
            <div className="space-y-1">
              <h1 className="text-2xl font-black leading-snug tracking-normal">
                ページが見つかりません
              </h1>
              <p className="text-xs text-ink/50">
                URLが間違っているか、リンクの有効期限が切れている可能性があります
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
          >
            トップへ戻る
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
