"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/lib/browserNavigation";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import StripePaymentForm from "@/components/billing/StripePaymentForm";
import SubscriptionManager from "@/components/billing/SubscriptionManager";
import AdminGrantedPlanNotice from "@/components/billing/AdminGrantedPlanNotice";
import PlanPicker from "@/components/billing/PlanPicker";
import type { SubscriptionResponse } from "@/app/api/billing/stripe/subscription/schema";
import type { CancellationResponse } from "@/app/api/billing/stripe/cancellation/schema";
import type { ChargeResponse as BtcChargeResponse } from "@/app/api/billing/btc/charge/schema";
import {
  PURCHASABLE_PLANS,
  type PurchasablePlan,
} from "@/lib/plan";
import { getStripe, STRIPE_PUBLISHABLE_KEY } from "@/lib/stripe-client";
import {
  loadPlanStatus,
  type PlanStatus,
} from "@/lib/account/planStatus";

// 購入可能プランは lib/plan.ts の PURCHASABLE_PLANS を単一の情報源とする
// (決済API側の受理判定と揃える)。Standard・Premiumを提供する。

// Webhook反映はStripeからの非同期通知を待つ必要があるため、決済確定直後は
// 少し間を空けて数回だけ最新のプランを取り直す(反映が間に合わなくても
// エラーにはせず、単に古い表示のまま次のポーリングを待つ)。取得は
// loadPlanStatus() = POST /api/billing/stripe/sync で、Webhookが届いて
// いなくてもStripe側の実際のSubscription状態を取り直してプランへ反映する。
const PLAN_REFRESH_DELAYS_MS = [1500, 3000, 5000];

type Props = {
  initialPaymentIntentClientSecret?: string;
};

export default function BillingPage({
  initialPaymentIntentClientSecret,
}: Props) {
  const router = useRouter();
  const [me, setMe] = useState<PlanStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState<
    "stripe" | "btc" | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PurchasablePlan>(
    PURCHASABLE_PLANS[0]
  );
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string;
    returnUrl: string;
  } | null>(null);
  const [subscriptionAction, setSubscriptionAction] = useState<
    "cancel" | "resume" | null
  >(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const refreshMe = async () => {
    const result = await loadPlanStatus();

    // ポーリング中は成功時だけ表示を更新する。401・エラーはここでは扱わない
    // (初回ロードで既に判定済み。ポーリングの失敗は次の再取得を待つ)。
    if (result.kind === "ok") {
      setMe(result.status);
    }
  };

  const schedulePlanRefresh = () => {
    for (const delay of PLAN_REFRESH_DELAYS_MS) {
      setTimeout(refreshMe, delay);
    }
  };

  // 初回表示のこのタイミングでStripe側のSubscription状態も取り直す
  // (Webhook不達で「課金済みなのに未反映」等になっていた場合の是正)。
  // 401(未ログイン)のときだけログインへ誘導する。500等のサーバーエラーで
  // 誘導すると、/mypage/loginがログイン済みを見てここへ戻しループになる。
  const load = useCallback(() => {
    loadPlanStatus().then((result) => {
      if (result.kind === "unauthenticated") {
        router.replace("/mypage/login");
        return;
      }

      if (result.kind === "error") {
        setLoadError(true);
        return;
      }

      setMe(result.status);
    });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = () => {
    setLoadError(false);
    setMe(null);
    setError("");
    setNotice("");
    load();
  };

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

    // 公開可能キーが未設定(環境変数の設定漏れ)だと、Subscription自体は
    // 作成できてもPayment Elementを表示できず、ユーザーが後で行き詰まる。
    // 決済用のSubscriptionを実際に作ってしまう前に、ここで止める。
    if (!STRIPE_PUBLISHABLE_KEY) {
      setError(
        "決済フォームの設定が完了していません。しばらくしてから再度お試しください。"
      );
      return;
    }

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

  // cancelAtPeriodEnd=true: 期間末で解約(自動更新を停止) /
  // false: 解約予約を取り消す(自動更新を再開)。
  const submitCancellation = async (cancelAtPeriodEnd: boolean) => {
    setError("");
    setNotice("");
    setSubscriptionAction(cancelAtPeriodEnd ? "cancel" : "resume");

    try {
      const response = await fetch("/api/billing/stripe/cancellation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtPeriodEnd }),
      });
      const data = (await response.json()) as CancellationResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "処理に失敗しました。");
      }

      setMe((prev) =>
        prev ? { ...prev, subscription: data.subscription } : prev
      );
      setConfirmingCancel(false);
      setNotice(
        cancelAtPeriodEnd
          ? "自動更新を停止しました。期間終了までは引き続きご利用いただけます。"
          : "自動更新を再開しました。"
      );
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setSubscriptionAction(null);
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

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              プラン・お支払い
            </h1>
            <p className="text-xs text-ink/50">
              プランの変更・お支払い方法・解約の手続きができます。
            </p>
            <a
              href="/mypage"
              className="inline-block pt-0.5 text-xs font-bold text-brand hover:underline"
            >
              ← マイページ
            </a>
          </div>

          {loadError ? (
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
          ) : me === null ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand" />
            </div>
          ) : (
            <div className="space-y-5">
              {notice && (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded border border-ink/15 bg-ink/[0.02] p-3 text-sm font-bold text-ink/70"
                >
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
              ) : me.subscription ? (
                <SubscriptionManager
                  subscription={me.subscription}
                  action={subscriptionAction}
                  confirmingCancel={confirmingCancel}
                  error={error}
                  onStartConfirm={() => setConfirmingCancel(true)}
                  onDismissConfirm={() => setConfirmingCancel(false)}
                  onCancel={() => submitCancellation(true)}
                  onResume={() => submitCancellation(false)}
                />
              ) : me.adminGranted ? (
                <AdminGrantedPlanNotice status={me} />
              ) : (
                <PlanPicker
                  selectedPlan={selectedPlan}
                  isLoadingAction={isLoadingAction}
                  error={error}
                  onSelectPlan={setSelectedPlan}
                  onStartStripe={startStripeSubscription}
                  onStartBtc={startBtcCharge}
                />
              )}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
