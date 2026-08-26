import type { ApiResponse } from "@/lib/api/response";

export type ChargeResponse = ApiResponse<{ hostedCheckoutUrl: string }>;
