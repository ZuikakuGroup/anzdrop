"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import {
  CheckIcon,
  XIcon,
  CreditCardIcon,
  BitcoinIcon,
} from "@/components/brand/ShareIcons";
import type { MeResponse } from "@/app/api/account/me/schema";
import type { CheckoutResponse } from "@/app/api/billing/stripe/checkout/schema";
import type { ChargeResponse as BtcChargeResponse } from "@/app/api/billing/btc/charge/schema";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_MONTHLY_PRICE_JPY,
  type Plan,
} from "@/lib/plan";
import { RETENTION_DAYS } from "@/lib/retention";
import { formatBytes } from "@/lib/format";

type MeData = { accountId: string; plan: Plan; planExpiresAt: string | null };

type PurchasablePlan = "standard" | "premium";

const ALL_PLANS: Plan[] = ["free", "standard", "premium"];

// 両方の決済方式(Stripeの月額サブスクリプション、BitcoinのOPENNODE_BTC_DAYS_PER_CHARGE)
// が共通して30日を1サイクルとして設計されているため、有効期限までの残り日数を
// 「サイクルに対する残り割合」として視覚化する際の分母に使う(正確な契約開始日は
// クライアントに渡っていないため、あくまで目安の表示)。
const NOMINAL_CYCLE_DAYS = 30;

function maxRetentionDays(plan: Plan): number {
  return Math.max(
    ...PLAN_LIMITS[plan].allowedRetentions.map((r) => RETENTION_DAYS[r])
  );
}

function remainingDaysUntil(expiresAt: string): number {
  const diffMs = new Date(expiresAt).getTime() - Date.now();

  if (!Number.isFinite(diffMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export default function BillingPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState<
    "stripe" | "btc" | null
  >(null);
  const [error, setError] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PurchasablePlan>(
    "standard"
  );

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (!data.success) {
          // 未ログインなら「ログインが必要です」の専用表示は出さず、そのままログインへ誘導する。
          router.push("/mypage/login");
          return;
        }

        setMe({
          accountId: data.accountId,
          plan: data.plan,
          planExpiresAt: data.planExpiresAt,
        });

        // 既にStandard/Premiumなら、そのプランを選択済みにしておく
        // (更新・再購入の導線として自然なため)。freeのままなら
        // デフォルトのStandardを維持する。
        if (data.plan === "standard" || data.plan === "premium") {
          setSelectedPlan(data.plan);
        }
      })
      .catch(() => setLoadError(true));
  }, [router]);

  const startStripeCheckout = async () => {
    setError("");
    setIsLoadingAction("stripe");

    try {
      const response = await fetch("/api/billing/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = (await response.json()) as CheckoutResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "開始に失敗しました。");
      }

      window.location.href = data.url;
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
      setIsLoadingAction(null);
    }
  };

  const startBtcCharge = async () => {
    setError("");
    setIsLoadingAction("btc");

    try {
      const response = await fetch("/api/billing/btc/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = (await response.json()) as BtcChargeResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "開始に失敗しました。");
      }

      window.location.href = data.hostedCheckoutUrl;
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
      setIsLoadingAction(null);
    }
  };

  const remainingDays =
    me && me.plan !== "free" && me.planExpiresAt
      ? remainingDaysUntil(me.planExpiresAt)
      : null;
  const cycleProgressPercent =
    remainingDays !== null
      ? Math.min(100, (remainingDays / NOMINAL_CYCLE_DAYS) * 100)
      : null;
  const isExpiringSoon = remainingDays !== null && remainingDays <= 3;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1 px-4 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <div className="space-y-1 text-center sm:text-left">
            <h1 className="text-2xl font-black leading-snug tracking-normal sm:text-3xl">
              プラン・お支払い
            </h1>
            <p className="text-sm text-ink/60">
              用途に合わせてプランを選び、より大きなファイルを、より長く共有できます。
            </p>
          </div>

          {loadError ? (
            <p className="text-sm font-bold text-brand">
              読み込みに失敗しました。
            </p>
          ) : me === null ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand" />
            </div>
          ) : (
            <div className="space-y-8">
              {/* 現在のプラン状況 */}
              <div className="rounded-lg border border-ink/10 bg-paper p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-ink/50">
                    現在のプラン
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-black ${
                      me.plan === "premium"
                        ? "bg-brand text-paper"
                        : me.plan === "standard"
                          ? "bg-brand/10 text-brand"
                          : "bg-ink/10 text-ink/70"
                    }`}
                  >
                    {PLAN_LABELS[me.plan]}
                  </span>
                  {isExpiringSoon && (
                    <span className="rounded bg-red-600/10 px-2 py-0.5 text-xs font-black text-red-700">
                      まもなく期限切れ
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink/60">
                  <span>
                    最大{formatBytes(PLAN_LIMITS[me.plan].maxFileSizeBytes)}
                  </span>
                  <span>最長{maxRetentionDays(me.plan)}日間保存</span>
                  <span>
                    {PLAN_LIMITS[me.plan].previewEnabled
                      ? "ブラウザ内プレビュー可"
                      : "ブラウザ内プレビュー不可"}
                  </span>
                </div>

                {remainingDays !== null && me.planExpiresAt && (
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink/50">
                        次回更新日:{" "}
                        {new Date(me.planExpiresAt).toLocaleDateString(
                          "ja-JP"
                        )}
                      </span>
                      <span
                        className={`font-bold ${
                          isExpiringSoon ? "text-red-700" : "text-ink/60"
                        }`}
                      >
                        残り{remainingDays}日
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          isExpiringSoon ? "bg-red-600" : "bg-brand"
                        }`}
                        style={{ width: `${cycleProgressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* プラン比較 */}
              <div>
                <h2 className="mb-3 text-sm font-black text-ink/70">
                  プランを選択
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ALL_PLANS.map((plan) => {
                    const isCurrent = plan === me.plan;
                    const isPurchasable = plan !== "free";
                    const isSelected =
                      isPurchasable && plan === selectedPlan;

                    return (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => {
                          if (isPurchasable) {
                            setSelectedPlan(plan as PurchasablePlan);
                          }
                        }}
                        disabled={!isPurchasable || isLoadingAction !== null}
                        className={`flex flex-col gap-3 rounded-lg border-2 p-4 text-left transition-colors disabled:cursor-default ${
                          isSelected
                            ? "border-brand bg-brand/5"
                            : "border-ink/15 hover:border-ink/30 disabled:hover:border-ink/15"
                        } ${!isPurchasable ? "disabled:opacity-70" : "disabled:opacity-30"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-base font-black">
                            {PLAN_LABELS[plan]}
                          </p>
                          {isCurrent && (
                            <span className="shrink-0 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-black text-ink/60">
                              現在のプラン
                            </span>
                          )}
                        </div>

                        <p className="text-lg font-black text-ink">
                          {plan === "free" ? (
                            "¥0"
                          ) : (
                            <>
                              ¥
                              {
                                PLAN_MONTHLY_PRICE_JPY[
                                  plan as PurchasablePlan
                                ]
                              }
                            </>
                          )}
                          <span className="text-xs font-bold text-ink/40">
                            {" "}
                            / 月
                          </span>
                        </p>

                        <ul className="space-y-1.5 text-xs text-ink/70">
                          <li className="flex items-center gap-1.5">
                            <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                            最大{formatBytes(PLAN_LIMITS[plan].maxFileSizeBytes)}
                          </li>
                          <li className="flex items-center gap-1.5">
                            <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                            最長{maxRetentionDays(plan)}日間保存
                          </li>
                          <li className="flex items-center gap-1.5">
                            {PLAN_LIMITS[plan].previewEnabled ? (
                              <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                            ) : (
                              <XIcon className="h-3.5 w-3.5 shrink-0 text-ink/30" />
                            )}
                            <span
                              className={
                                PLAN_LIMITS[plan].previewEnabled
                                  ? ""
                                  : "text-ink/40"
                              }
                            >
                              ブラウザ内プレビュー
                            </span>
                          </li>
                        </ul>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 決済 */}
              <div className="mx-auto w-full max-w-md space-y-3 rounded-lg border border-ink/10 bg-paper p-6">
                <p className="text-center text-sm">
                  <span className="font-black">
                    {PLAN_LABELS[selectedPlan]}
                  </span>
                  を
                  <span className="font-black text-brand">
                    ¥{PLAN_MONTHLY_PRICE_JPY[selectedPlan]} / 月
                  </span>
                  で契約します
                </p>

                <button
                  onClick={startStripeCheckout}
                  disabled={isLoadingAction !== null}
                  className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
                >
                  {isLoadingAction === "stripe" ? (
                    <Spinner className="h-4 w-4 text-paper" />
                  ) : (
                    <CreditCardIcon className="h-4 w-4" />
                  )}
                  カードで契約する(Stripe)
                </button>

                <button
                  onClick={startBtcCharge}
                  disabled
                  className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3.5 text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-30"
                >
                  <BitcoinIcon className="h-4 w-4" />
                  ビットコインで支払う(準備中)
                </button>

                <p className="text-center text-xs text-ink/50">
                  ビットコイン決済は現在準備中のため、しばらくお待ちください。
                </p>

                <p className="min-h-[20px] text-center text-sm font-bold text-brand">
                  {error}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
