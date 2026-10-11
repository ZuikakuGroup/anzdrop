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
  // accounts.stripe_subscription_id が「いま実際に管理対象として生きている」
  // Stripe 契約(active / trialing / past_due)を指しているか。GET / POST /
  // DELETE いずれも Stripe へ retrieve して確認する(ポインタの有無だけでは
  // 判定しない。決済フォームを開いて離脱しただけの incomplete /
  // incomplete_expired のゴミポインタを警告対象から除くため)。true の場合、
  // /admin からの付与・free 化は次回の Stripe 同期 / Webhook で上書きされうる。
  // retrieve に失敗したときは保守的に true(警告を残す)。
  hasStripeSubscription: boolean;
};

export type AdminAccountResponse = ApiResponse<{ account: AdminAccountInfo }>;
