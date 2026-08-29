"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import StripePaymentForm from "@/components/billing/StripePaymentForm";
import type { MeResponse } from "@/app/api/account/me/schema";
import type { SubscriptionResponse } from "@/app/api/billing/stripe/subscription/schema";
import type { ChargeResponse as BtcChargeResponse } from "@/app/api/billing/btc/charge/schema";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_MONTHLY_PRICE_JPY,
  type Plan,
} from "@/lib/plan";
import { formatBytes } from "@/lib/format";
import { getStripe } from "@/lib/stripe-client";

type MeData = { accountId: string; plan: Plan; planExpiresAt: string | null };

type PurchasablePlan = "standard" | "premium";

const PURCHASABLE_PLANS: PurchasablePlan[] = ["standard", "premium"];

// Webhook反映はStripeからの非同期通知を待つ必要があるため、決済確定直後は
// 少し間を空けて数回だけ最新のプランを取り直す(反映が間に合わなくても
// エラーにはせず、単に古い表示のまま次のポーリングを待つ)。
const PLAN_REFRESH_DELAYS_MS = [1500, 3000, 5000];

type Props = {
  initialPaymentIntentClientSecret?: string;
};

export default function BillingPage({
  initialPaymentIntentClientSecret,
}: Props) {
  const [me, setMe] = useState<MeData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState<
    "stripe" | "btc" | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PurchasablePlan>(
    "standard"
  );
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string;
    returnUrl: string;
  } | null>(null);

  const refreshMe = async () => {
    try {
      const response = await fetch("/api/account/me");
      const data = (await response.json()) as MeResponse;

      if (data.success) {
        setMe({
          accountId: data.accountId,
          plan: data.plan,
          planExpiresAt: data.planExpiresAt,
        });
      }
    } catch {
      // ポーリングの失敗は致命的ではないため、次の再取得を待つだけにする。
    }
  };

  const schedulePlanRefresh = () => {
    for (const delay of PLAN_REFRESH_DELAYS_MS) {
      setTimeout(refreshMe, delay);
    }
  };

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (!data.success) {
          // 未ログインなら「ログインが必要です」の専用表示は出さず、そのままログインへ誘導する。
          window.location.href = "/mypage/login";
          return;
        }

        setMe({
          accountId: data.accountId,
          plan: data.plan,
          planExpiresAt: data.planExpiresAt,
        });
      })
      .catch(() => setLoadError(true));
  }, []);

  // カード決済の3Dセキュア等が稀にページ遷移を伴う場合のフォールバック。
  // 通常のカード決済(redirect: "if_required")ではここは使われない。
  useEffect(() => {
    if (!initialPaymentIntentClientSecret) {
      return;
    }

    getStripe().then(async (stripe) => {
      if (!stripe) {
        return;
      }

      const { paymentIntent } = await stripe.retrievePaymentIntent(
        initialPaymentIntentClientSecret
      );

      if (
        paymentIntent?.status === "succeeded" ||
        paymentIntent?.status === "processing"
      ) {
        setNotice(
          "お支払いを受け付けました。プランへの反映まで少々お待ちください。"
        );
        schedulePlanRefresh();
      } else if (paymentIntent?.status === "requires_payment_method") {
        setError("決済が完了しませんでした。もう一度お試しください。");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回マウント時のURLパラメータのみを見る
  }, [initialPaymentIntentClientSecret]);

  const startStripeSubscription = async () => {
    setError("");
    setNotice("");
    setIsLoadingAction("stripe");

    try {
      const response = await fetch("/api/billing/stripe/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = (await response.json()) as SubscriptionResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "開始に失敗しました。");
      }

      setStripePayment({
        clientSecret: data.clientSecret,
        returnUrl: `${window.location.origin}/mypage/billing?checkout=return`,
      });
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setIsLoadingAction(null);
    }
  };

  const handlePaymentSuccess = () => {
    setStripePayment(null);
    setNotice(
      "お支払いが完了しました。プランへの反映まで少々お待ちください。"
    );
    schedulePlanRefresh();
  };

  const handlePaymentCancel = () => {
    setStripePayment(null);
    setNotice("");
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

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              プラン・お支払い
            </h1>
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
            <div className="space-y-5">
              <div className="rounded border-2 border-ink/20 p-4 text-sm">
                <p className="font-bold">
                  現在のプラン: {PLAN_LABELS[me.plan]}
                </p>
                {me.plan !== "free" && me.planExpiresAt && (
                  <p className="mt-1 text-xs text-ink/60">
                    有効期限:{" "}
                    {new Date(me.planExpiresAt).toLocaleString("ja-JP")}
                  </p>
                )}
              </div>

              {notice && (
                <p className="rounded border-2 border-ink/20 p-3 text-sm font-bold text-ink/70">
                  {notice}
                </p>
              )}

              {stripePayment ? (
                <StripePaymentForm
                  clientSecret={stripePayment.clientSecret}
                  returnUrl={stripePayment.returnUrl}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handlePaymentCancel}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {PURCHASABLE_PLANS.map((plan) => (
                      <button
                        key={plan}
                        type="button"
                        onClick={() => setSelectedPlan(plan)}
                        disabled={isLoadingAction !== null}
                        className={`rounded border-2 p-3 text-left text-xs transition-colors disabled:opacity-30 ${
                          selectedPlan === plan
                            ? "border-brand bg-brand/5"
                            : "border-ink/20 hover:border-ink/40"
                        }`}
                      >
                        <p className="text-sm font-black">
                          {PLAN_LABELS[plan]}
                        </p>
                        <p className="mt-0.5 font-bold text-ink/70">
                          ¥{PLAN_MONTHLY_PRICE_JPY[plan]} / 月
                        </p>
                        <ul className="mt-2 space-y-0.5 text-ink/60">
                          <li>
                            最大
                            {formatBytes(PLAN_LIMITS[plan].maxFileSizeBytes)}
                          </li>
                          <li>
                            {PLAN_LIMITS[plan].previewEnabled
                              ? "ブラウザ内プレビュー可"
                              : "プレビュー不可"}
                          </li>
                        </ul>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={startStripeSubscription}
                      disabled={isLoadingAction !== null}
                      className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
                    >
                      {isLoadingAction === "stripe" && (
                        <Spinner className="h-4 w-4 text-paper" />
                      )}
                      カードで契約する
                    </button>

                    <button
                      onClick={startBtcCharge}
                      disabled
                      className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3.5 text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-30"
                    >
                      ビットコインで支払う(準備中)
                    </button>

                    <p className="text-center text-xs text-ink/50">
                      ビットコイン決済は現在準備中のため、しばらくお待ちください。
                    </p>
                  </div>

                  <p className="min-h-[20px] text-sm font-bold text-brand">
                    {error}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
