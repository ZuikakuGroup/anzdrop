import type { ApiResponse } from "@/lib/api/response";
import type { Plan } from "@/lib/plan";
import type { StripeSubscriptionSummary } from "@/lib/stripe-subscription";

// 同期後の最新プラン情報に加えて、カード契約(自動更新サブスク)の状態も返す。
// subscription が null のときは、契約が無い or 有効でない(契約フローを表示)。
export type StripeSyncResponse = ApiResponse<{
  accountId: string;
  plan: Plan;
  planExpiresAt: string | null;
  subscription: StripeSubscriptionSummary | null;
}>;
