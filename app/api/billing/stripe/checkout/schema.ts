import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const CheckoutRequestSchema = z.object({
  plan: z.enum(["standard", "premium"], { error: "プランの指定が正しくありません" }),
});

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export type CheckoutResponse = ApiResponse<{ url: string }>;
