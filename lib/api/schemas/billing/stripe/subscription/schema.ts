import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const SubscriptionRequestSchema = z.object({
  plan: z.enum(["standard", "premium"], { error: "プランの指定が正しくありません" }),
});

export type SubscriptionRequest = z.infer<typeof SubscriptionRequestSchema>;

export type SubscriptionResponse = ApiResponse<{ clientSecret: string }>;
