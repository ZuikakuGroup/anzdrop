import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { isValidAccountId } from "@/lib/account/id";

const ACCOUNT_ID_ERROR =
  "Account ID must be 3-32 characters and contain only letters, numbers, hyphens, and underscores";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const PASSWORD_LENGTH_ERROR = `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`;

export const SignupRequestSchema = z.object({
  accountId: z
    .string({ error: ACCOUNT_ID_ERROR })
    .refine(isValidAccountId, { error: ACCOUNT_ID_ERROR }),
  password: z
    .string({ error: PASSWORD_LENGTH_ERROR })
    .min(MIN_PASSWORD_LENGTH, { error: PASSWORD_LENGTH_ERROR })
    .max(MAX_PASSWORD_LENGTH, { error: PASSWORD_LENGTH_ERROR }),
  turnstileToken: z.string().optional(),
});

export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export type SignupResponse = ApiResponse<{
  accountId: string;
  recoveryCode: string;
}>;
