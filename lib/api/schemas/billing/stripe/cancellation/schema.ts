import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import type { StripeSubscriptionSummary } from "@/lib/stripe-subscription";

export const CancellationRequestSchema = z.object({
  // true: 期間末で解約(自動更新を停止) / false: 解約予約を取り消す(自動更新を再開)
  cancelAtPeriodEnd: z.boolean({ error: "指定が正しくありません" }),
});

export type CancellationRequest = z.infer<typeof CancellationRequestSchema>;

export type CancellationResponse = ApiResponse<{
  subscription: StripeSubscriptionSummary | null;
}>;
