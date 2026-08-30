import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import type { Plan } from "@/lib/plan";

// /adminからのプラン付与リクエスト。expiresAtがnullなら「無期限」
// (INDEFINITE_PLAN_EXPIRES_ATへ変換して格納)、文字列なら「その日時まで有効」。
// 文字列は解釈可能な日付で、かつ未来である必要がある(未来判定はルート側)。
export const GrantPlanRequestSchema = z.object({
  plan: z.enum(["standard", "premium"], {
    error: "プランの指定が正しくありません",
  }),
  expiresAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      error: "有効期限の日付が正しくありません",
    })
    .nullable(),
});

export type GrantPlanRequest = z.infer<typeof GrantPlanRequestSchema>;

export type AdminAccountInfo = {
  // 指定されたアカウントIDのアカウントが存在するか。存在しない場合、以降の
  // フィールドは既定値(free / null / false)。
  exists: boolean;
  // accounts.planをPlan型へ正規化した「DB上の」プラン。期限切れでも有料値のまま。
  storedPlan: Plan;
  // 期限切れを加味した実効プラン(effectivePlan())。
  effectivePlan: Plan;
  planExpiresAt: string | null;
  // planExpiresAtが「無期限」の番兵値か。
  indefinite: boolean;
  // accounts.stripe_subscription_idが設定されているか。設定されている場合、
  // /adminからの付与・free化は次回のStripe同期/Webhookで上書きされうる。
  // (実際にStripe上でactiveかどうかまではここでは確認しない。)
  hasStripeSubscription: boolean;
};

export type AdminAccountResponse = ApiResponse<{ account: AdminAccountInfo }>;
