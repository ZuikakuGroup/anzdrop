import {
  PLAN_LABELS,
} from "@/lib/plan";
import {
  describeContract,
  type PlanStatus,
} from "@/lib/account/planStatus";

// /admin から付与された有料プラン中。追加のカード/Bitcoin 契約は出さない。
export default function AdminGrantedPlanNotice({ status }: { status: PlanStatus }) {
  const contract = describeContract(status);

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded border border-ink/15 bg-ink/[0.02] p-4">
        <p className="text-xs font-bold text-ink/50">現在のプラン</p>
        <p className="text-lg font-black">{PLAN_LABELS[status.plan]}</p>
        <p className="text-sm font-bold text-ink/70">{contract.stateLabel}</p>
        {contract.detail && (
          <p className="text-xs text-ink/60">{contract.detail}</p>
        )}
        {contract.note && (
          <p className="pt-1 text-xs leading-relaxed text-ink/60">
            {contract.note}
          </p>
        )}
      </div>

      <div
        aria-disabled="true"
        className="space-y-2 opacity-40"
      >
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper disabled:opacity-100"
        >
          カードで契約する
        </button>
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3.5 text-sm font-black tracking-wider text-ink disabled:opacity-100"
        >
          ビットコインで支払う(準備中)
        </button>
      </div>

      <p className="text-center text-xs leading-relaxed text-ink/50">
        運営により付与されたプランの利用中は、こちらから追加の契約はできません。
      </p>
    </div>
  );
}
