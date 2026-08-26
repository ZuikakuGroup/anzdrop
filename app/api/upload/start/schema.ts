import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { isRetention, type Retention } from "@/lib/retention";

export const UploadStartRequestSchema = z.object({
  encryptedFileName: z
    .string({ error: "Missing encryptedFileName" })
    .min(1, { error: "Missing encryptedFileName" }),
  retention: z
    .string({ error: "Invalid retention" })
    .refine((value): value is Retention => isRetention(value), {
      error: "Invalid retention",
    }),
  fileSize: z
    .number({ error: "Missing fileSize" })
    .positive({ error: "Missing fileSize" }),
  shareId: z.string().optional(),
  uploadToken: z.string().optional(),
  wrappedKey: z.string().optional(),
  keySalt: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export type UploadStartRequest = z.infer<typeof UploadStartRequestSchema>;

export type UploadStartResponse = ApiResponse<{
  shareId: string;
  uploadToken: string;
  uploadSessionId: string;
  expiresAt: string;
}>;
