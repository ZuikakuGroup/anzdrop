import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const INVALID_REQUEST_ERROR = "Invalid request";

export const RecoverRequestSchema = z.object({
  accountId: z.string({ error: INVALID_REQUEST_ERROR }),
  recoveryCode: z.string({ error: INVALID_REQUEST_ERROR }),
  newPassword: z
    .string({ error: INVALID_REQUEST_ERROR })
    .min(MIN_PASSWORD_LENGTH, { error: INVALID_REQUEST_ERROR })
    .max(MAX_PASSWORD_LENGTH, { error: INVALID_REQUEST_ERROR }),
  turnstileToken: z.string().optional(),
});

export type RecoverRequest = z.infer<typeof RecoverRequestSchema>;

export type RecoverResponse = ApiResponse<{ recoveryCode: string }>;
