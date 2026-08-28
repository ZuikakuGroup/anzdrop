import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const LoginRequestSchema = z.object({
  accountId: z.string({ error: "アカウントIDまたはパスワードが入力されていません" }),
  password: z.string({ error: "アカウントIDまたはパスワードが入力されていません" }),
  turnstileToken: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export type LoginResponse = ApiResponse;
