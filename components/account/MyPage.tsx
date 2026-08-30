"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import {
  describeBillingCta,
  describeContract,
  loadPlanStatus,
  type PlanStatusResult,
} from "@/lib/account/planStatus";
import { PLAN_LABELS, PLAN_LIMITS, getMaxRetentionDays } from "@/lib/plan";
import { formatBytes } from "@/lib/format";

type LoadedResult = Exclude<PlanStatusResult, { kind: "unauthenticated" }>;

export default function MyPage() {
  const router = useRouter();
  const [result, setResult] = useState<LoadedResult | null>(null);

  const load = useCallback(() => {
    loadPlanStatus().then((next) => {
      // 未ログインのときだけログインへ誘導する。500等は「読み込みに失敗しました。」
      // 表示に留める(誘導すると/mypage/login側がログイン済みを見て戻しループになる)。
      if (next.kind === "unauthenticated") {
        router.replace("/mypage/login");
        return;
      }

      setResult(next);
    });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = () => {
    setResult(null);
    load();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              マイページ
            </h1>
            <p className="text-xs text-ink/50">
              アカウントと現在のプランを確認できます。
            </p>
          </div>

          <div className="min-h-[240px]">
            {result === null ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6 text-brand" />
              </div>
            ) : result.kind === "error" ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm font-bold text-brand">
                  一時的に読み込めませんでした。時間をおいて再度お試しください。
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="w-full rounded border-2 border-ink/20 px-4 py-3 text-sm font-black tracking-wider text-ink/70 transition-colors hover:border-ink/40"
                >
                  再読み込み
                </button>
              </div>
            ) : (
              <MyPageOverview result={result} />
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function MyPageOverview({
  result,
}: {
  result: Extract<LoadedResult, { kind: "ok" }>;
}) {
  const { status } = result;
  const contract = describeContract(status);
  const limits = PLAN_LIMITS[status.plan];
  const billingCta = describeBillingCta(status.subscription?.state ?? null);

  return (
    <div className="space-y-5">
      <div className="rounded border border-ink/15 bg-ink/[0.02] p-4 text-sm">
        <p className="text-xs font-bold text-ink/50">アカウントID</p>
        <p className="mt-0.5 break-all font-mono">{status.accountId}</p>
      </div>

      <div className="rounded border border-ink/15 bg-ink/[0.02] p-4 text-sm">
        <p className="text-xs font-bold text-ink/50">現在のプラン</p>
        <p className="mt-0.5 font-bold">{PLAN_LABELS[status.plan]}</p>
        <p className="mt-1 text-xs font-bold text-ink/70">
          {contract.stateLabel}
        </p>
        {contract.detail && (
          <p className="mt-0.5 text-xs text-ink/60">{contract.detail}</p>
        )}
        {contract.note && (
          <p className="mt-1 text-xs text-ink/50">{contract.note}</p>
        )}

        <ul className="mt-3 space-y-0.5 border-t border-ink/10 pt-3 text-xs text-ink/60">
          <li>
            最大ファイルサイズ: {formatBytes(limits.maxFileSizeBytes)}
          </li>
          <li>最大保存期間: {getMaxRetentionDays(status.plan)}日</li>
          <li>
            ブラウザ内プレビュー: {limits.previewEnabled ? "可" : "不可"}
          </li>
        </ul>
      </div>

      <a
        href="/mypage/billing"
        className={
          billingCta.tone === "primary"
            ? "flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
            : "flex w-full items-center justify-center gap-2 rounded border-2 border-ink/20 px-4 py-3 text-sm font-black tracking-wider text-ink/70 transition-colors hover:border-ink/40"
        }
      >
        {billingCta.label}
      </a>

      <p className="text-xs leading-relaxed text-ink/50">
        パスワードを忘れた場合の再設定は、リカバリーコードでのみ行えます。<br />リカバリーコードを紛失すると復旧できません。
      </p>
    </div>
  );
}
