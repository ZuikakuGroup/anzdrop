import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const ChargeRequestSchema = z.object({
  plan: z.enum(["standard", "premium"], { error: "プランの指定が正しくありません" }),
});

export type ChargeRequest = z.infer<typeof ChargeRequestSchema>;

export type ChargeResponse = ApiResponse<{ hostedCheckoutUrl: string }>;
