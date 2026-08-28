import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export const ContactRequestSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export type ContactRequest = z.infer<typeof ContactRequestSchema>;

export type ContactResponse = ApiResponse;
