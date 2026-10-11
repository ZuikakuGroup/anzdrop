import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

// "rights_infringement" はUIから選択させず、reportType === "rights_holder" の
// 場合にサーバー側で自動的に割り当てるカテゴリ。
export const RIGHT_TYPES = ["copyright", "trademark", "portrait", "other"] as const;
export type RightType = (typeof RIGHT_TYPES)[number];

export const REPORT_CATEGORIES = [
  "csam",
  "malware",
  "privacy",
  "spam",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number] | "rights_infringement";

export type ReportType = "general" | "rights_holder";

// shareId/reasonは、元の実装ではTurnstile検証より後に必須チェックされる
// (`requestBody.shareId ?? ""`のように扱われる)ため、ここでは形状のみを
// 緩く定義し、必須チェック自体はTurnstile検証の後でroute.tsが行う。
export const ReportRequestSchema = z.object({
  reportType: z.string().optional(),
  shareId: z.string().optional(),
  reason: z.string().optional(),
  category: z.string().optional(),
  claimantName: z.string().optional(),
  contactEmail: z.string().optional(),
  rightType: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export type ReportResponse = ApiResponse;
