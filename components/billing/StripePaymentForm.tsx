"use client";

import { useState, type FormEvent } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type {
  StripeElementsOptions,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import Spinner from "@/components/brand/Spinner";
import { getStripe } from "@/lib/stripe-client";

// フォームの見た目をアプリのブランドカラー(app/globals.cssのCSS変数)に
// 合わせるためのAppearance API設定。
const APPEARANCE: StripeElementsOptions["appearance"] = {
  theme: "stripe",
  variables: {
    colorPrimary: "#f15a22",
    colorBackground: "#ffffff",
    colorText: "#0a0a0a",
    borderRadius: "4px",
    fontFamily: "inherit",
  },
};

const PAYMENT_ELEMENT_OPTIONS: StripePaymentElementOptions = {
  layout: "tabs",
};

type PayButtonProps = {
  returnUrl: string;
  onSuccess: () => void;
  onCancel: () => void;
};

function PayButton({ returnUrl, onSuccess, onCancel }: PayButtonProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    // redirect: "if_required"により、カード決済で追加の本人認証(3Dセキュア等)が
    // 必要な場合もページ内モーダルで完結し、通常はreturn_urlへの遷移は発生しない。
    // return_url自体はStripe API上必須のため、稀な代替決済手段向けのフォールバック
    // (戻り先)として渡しておく。
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment(
      {
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      }
    );

    if (confirmError) {
      setError(
        confirmError.message ??
          "決済の確定に失敗しました。もう一度お試しください。"
      );
      setIsSubmitting(false);
      return;
    }

    if (
      paymentIntent?.status === "succeeded" ||
      paymentIntent?.status === "processing"
    ) {
      onSuccess();
      return;
    }

    setError("決済を完了できませんでした。もう一度お試しください。");
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={PAYMENT_ELEMENT_OPTIONS} />

      <p role="alert" className="min-h-[20px] text-sm font-bold text-brand">
        {error}
      </p>

      <div className="space-y-2">
        <button
          type="submit"
          disabled={!stripe || !elements || isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
        >
          {isSubmitting && <Spinner className="h-4 w-4 text-paper" />}
          支払いを確定する
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="w-full rounded border-2 border-ink/20 px-4 py-3 text-sm font-black tracking-wider text-ink/70 transition-colors hover:border-ink/40 disabled:opacity-30"
        >
          やめる
        </button>
      </div>
    </form>
  );
}

type Props = {
  clientSecret: string;
  returnUrl: string;
  onSuccess: () => void;
  onCancel: () => void;
};

export default function StripePaymentForm({
  clientSecret,
  returnUrl,
  onSuccess,
  onCancel,
}: Props) {
  return (
    <Elements
      stripe={getStripe()}
      options={{ clientSecret, appearance: APPEARANCE }}
    >
      <PayButton returnUrl={returnUrl} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}
