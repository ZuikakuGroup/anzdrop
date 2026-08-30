"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import StripePaymentForm from "@/components/billing/StripePaymentForm";
import type { SubscriptionResponse } from "@/app/api/billing/stripe/subscription/schema";
import type { CancellationResponse } from "@/app/api/billing/stripe/cancellation/schema";
import type { ChargeResponse as BtcChargeResponse } from "@/app/api/billing/btc/charge/schema";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_MONTHLY_PRICE_JPY,
} from "@/lib/plan";
import { formatBytes } from "@/lib/format";
import { getStripe, STRIPE_PUBLISHABLE_KEY } from "@/lib/stripe-client";
import type { StripeSubscriptionSummary } from "@/lib/stripe-subscription";
import { loadPlanStatus, type PlanStatus } from "@/lib/account/planStatus";

type PurchasablePlan = "standard" | "premium";

// Standardプランは提供準備中(Issue #5)のため、購入導線には出さない。
// スキーマ・APIルート・環境変数(STRIPE_PRICE_ID_STANDARD 等)はStandardも
// 受け付けられる状態のまま残してあるので、提供開始時はこの配列に "standard" を
// 戻すだけでよい。/pricing でも Standard は「準備中」表示のみ。
const PURCHASABLE_PLANS: PurchasablePlan[] = ["premium"];

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

      <main className="flex flex-1 items-center justify-center p-4">
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
              ) : (
                <>
                  <div
                    className={`grid gap-2 ${
                      PURCHASABLE_PLANS.length > 1 ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
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

                  <div className="space-y-1 rounded border border-ink/15 bg-ink/[0.02] p-3 text-xs leading-relaxed text-ink/70">
                    <p className="font-bold text-ink">
                      お申し込み内容(クレジットカードの場合)
                    </p>
                    <p>
                      {PLAN_LABELS[selectedPlan]} ― 月額 ¥
                      {PLAN_MONTHLY_PRICE_JPY[selectedPlan].toLocaleString(
                        "ja-JP"
                      )}
                      (消費税込み)
                    </p>
                    <p>
                      契約期間の定めはなく、解約されるまで毎月自動的に更新・課金されます。決済の完了後、プランへの反映まで少しお時間をいただくことがあります。
                    </p>
                    <p>
                      自動更新はこの「プラン・お支払い」画面からいつでも停止でき、日割りでの返金はありません。
                    </p>
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

                  <p className="text-center text-xs leading-relaxed text-ink/50">
                    お申し込みの前に{" "}
                    <a
                      href="/legal/terms"
                      className="font-bold text-brand hover:underline"
                    >
                      利用規約
                    </a>
                    {" ・ "}
                    <a
                      href="/legal/tokushoho"
                      className="font-bold text-brand hover:underline"
                    >
                      特定商取引法に基づく表記
                    </a>
                    {" "}をご確認ください。
                  </p>

                  <p
                    role="alert"
                    className="min-h-[20px] text-sm font-bold text-brand"
                  >
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

// 期間末の日付。取得できない稀なケースでは日付を出さず「現在の請求期間の終了時」
// という言い回しにする(文が「〜に終了します」で自然につながるようにする)。
function formatPeriodEnd(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString("ja-JP")
    : "現在の請求期間の終了時";
}

type SubscriptionManagerProps = {
  subscription: StripeSubscriptionSummary;
  action: "cancel" | "resume" | null;
  confirmingCancel: boolean;
  error: string;
  onStartConfirm: () => void;
  onDismissConfirm: () => void;
  onCancel: () => void;
  onResume: () => void;
};

// カード契約(自動更新サブスク)がある場合に、契約フローの代わりに表示する
// 管理ブロック。解約は「期間末で自動更新を停止」で、期間中はいつでも取り消せる。
function SubscriptionManager({
  subscription,
  action,
  confirmingCancel,
  error,
  onStartConfirm,
  onDismissConfirm,
  onCancel,
  onResume,
}: SubscriptionManagerProps) {
  const busy = action !== null;
  const periodEnd = formatPeriodEnd(subscription.currentPeriodEnd);
  // active も past_due も「自動更新が動いている(=停止できる)」側。
  // canceling(解約予約済み)のときだけ再開ボタンを出す。
  const autoRenewing = subscription.state !== "canceling";

  return (
    <div className="space-y-4">
      <div className="rounded border border-ink/15 bg-ink/[0.02] p-4 text-sm">
        {subscription.state === "active" ? (
          <>
            <p className="font-bold">カードでの自動更新が有効です。</p>
            {subscription.currentPeriodEnd && (
              <p className="mt-1 text-xs text-ink/60">
                次回更新日: {periodEnd}
              </p>
            )}
          </>
        ) : subscription.state === "past_due" ? (
          <>
            <p className="font-bold">お支払いの確認が取れていません。</p>
            <p className="mt-1 text-xs text-ink/60">
              カードの有効期限切れなどで自動更新の決済に失敗しています。お支払い方法の変更が必要な場合はお問い合わせください。このまま自動更新を停止することもできます。
            </p>
          </>
        ) : (
          <>
            <p className="font-bold">{periodEnd}にこのプランは終了します。</p>
            <p className="mt-1 text-xs text-ink/60">
              自動更新は停止済みです。終了後は自動的に無料プランへ戻ります。
            </p>
          </>
        )}
      </div>

      {autoRenewing ? (
        confirmingCancel ? (
          <div className="space-y-2">
            <p className="text-sm font-bold">
              {subscription.state === "past_due"
                ? "自動更新を停止します。失敗している決済のリトライは続き、成功しなければ有効期限の到来時に無料プランへ戻ります。よろしいですか?"
                : `解約すると、${periodEnd}に無料プランへ戻ります。よろしいですか?`}
            </p>
            <button
              type="button"
              onClick={onDismissConfirm}
              disabled={busy}
              className="w-full rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              解約しない
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3 text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-30"
            >
              {action === "cancel" && <Spinner className="h-4 w-4 text-ink" />}
              解約する
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartConfirm}
            disabled={busy}
            className="w-full rounded border-2 border-ink/20 px-4 py-3 text-sm font-black tracking-wider text-ink/70 transition-colors hover:border-ink/40 disabled:opacity-30"
          >
            解約する
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={onResume}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
        >
          {action === "resume" && <Spinner className="h-4 w-4 text-paper" />}
          解約を取り消す
        </button>
      )}

      <p role="alert" className="min-h-[20px] text-sm font-bold text-brand">
        {error}
      </p>
    </div>
  );
}
