import Spinner from "@/components/brand/Spinner";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_MONTHLY_PRICE_JPY,
  PURCHASABLE_PLANS,
  type PurchasablePlan,
} from "@/lib/plan";
import { formatBytes } from "@/lib/format";

type PlanPickerProps = {
  selectedPlan: PurchasablePlan;
  isLoadingAction: "stripe" | "btc" | null;
  error: string;
  onSelectPlan: (plan: PurchasablePlan) => void;
  onStartStripe: () => void;
  onStartBtc: () => void;
};

// 未契約時のプラン選択・決済ボタン・特商法リンク。決済開始処理は親が担う。
export default function PlanPicker({
  selectedPlan,
  isLoadingAction,
  error,
  onSelectPlan,
  onStartStripe,
  onStartBtc,
}: PlanPickerProps) {
  return (
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
            onClick={() => onSelectPlan(plan)}
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
          (税込)
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
          onClick={onStartStripe}
          disabled={isLoadingAction !== null}
          className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
        >
          {isLoadingAction === "stripe" && (
            <Spinner className="h-4 w-4 text-paper" />
          )}
          カードで契約する
        </button>

        <button
          onClick={onStartBtc}
          disabled
          className="flex w-full items-center justify-center gap-2 rounded border-2 border-ink px-4 py-3.5 text-sm font-black tracking-wider text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-30"
        >
          ビットコインで支払う(準備中)
        </button>
      </div>

      <p className="text-center text-xs leading-relaxed text-ink/50">
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
          特定商取引法
        </a>
      </p>

      <p
        role="alert"
        className="min-h-[20px] text-sm font-bold text-brand"
      >
        {error}
      </p>
    </>
  );
}
