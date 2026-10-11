import type { ApiResponse } from "@/lib/api/response";

export type ChunkUploadResponse = ApiResponse<{ partNumber: number }>;
