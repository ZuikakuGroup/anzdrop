import Spinner from "@/components/brand/Spinner";
import type { StripeSubscriptionSummary } from "@/lib/stripe-subscription";

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
export default function SubscriptionManager({
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
