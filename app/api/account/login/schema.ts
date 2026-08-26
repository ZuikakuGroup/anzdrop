import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const LoginRequestSchema = z.object({
  accountId: z.string({ error: "Missing accountId or password" }),
  password: z.string({ error: "Missing accountId or password" }),
  turnstileToken: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export type LoginResponse = ApiResponse;
