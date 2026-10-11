import type { ApiResponse } from "@/lib/api/response";
import type { Plan } from "@/lib/plan";

export type MeResponse = ApiResponse<{
  accountId: string;
  plan: Plan;
  planExpiresAt: string | null;
}>;
