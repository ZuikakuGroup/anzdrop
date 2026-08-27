"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import type { MeResponse } from "@/app/api/account/me/schema";
import type { CheckoutResponse } from "@/app/api/billing/stripe/checkout/schema";
import type { ChargeResponse as BtcChargeResponse } from "@/app/api/billing/btc/charge/schema";
import type { Plan } from "@/lib/plan";

type MeData = { accountId: string; plan: Plan; planExpiresAt: string | null };

export default function BillingPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState<
    "stripe" | "btc" | null
  >(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (!data.success) {
          // 未ログインなら「ログインが必要です」の専用表示は出さず、そのままログインへ誘導する。
          window.location.href = "/login";
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

  const startStripeCheckout = async () => {
    setError("");
    setIsLoadingAction("stripe");

    try {
      const response = await fetch("/api/billing/stripe/checkout", {
        method: "POST",
      });
      const data = (await response.json()) as CheckoutResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "開始に失敗しました。");
      }

      window.location.href = data.url;
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("Unknown error");

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
      });
      const data = (await response.json()) as BtcChargeResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "開始に失敗しました。");
      }

      window.location.href = data.hostedCheckoutUrl;
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("Unknown error");

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
                  現在のプラン: {me.plan === "paid" ? "有料プラン" : "無料プラン"}
                </p>
                {me.plan === "paid" && me.planExpiresAt && (
                  <p className="mt-1 text-xs text-ink/60">
                    有効期限:{" "}
                    {new Date(me.planExpiresAt).toLocaleString("ja-JP")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <button
                  onClick={startStripeCheckout}
                  disabled={isLoadingAction !== null}
                  className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
                >
                  {isLoadingAction === "stripe" && (
                    <Spinner className="h-4 w-4 text-paper" />
                  )}
                  カードで契約する(Stripe)
                </button>

                <button
                  onClick={startBtcCharge}
                  disabled={isLoadingAction !== null}
                  className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3.5 text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-30"
                >
                  {isLoadingAction === "btc" && (
                    <Spinner className="h-4 w-4 text-ink" />
                  )}
                  ビットコインで支払う
                </button>

                <p className="text-center text-xs text-ink/50">
                  ビットコイン決済は自動更新されません。期限が来たら都度お支払いください。
                </p>
              </div>

              <p className="min-h-[20px] text-sm font-bold text-brand">
                {error}
              </p>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
