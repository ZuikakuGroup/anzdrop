import type { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

// リクエストボディのJSONパース失敗(不正なJSON構文)は従来どおり例外として
// 呼び出し元(withApiHandler)に伝播させ、汎用500応答にする。zodによる形状
// 検証はJSONとして正しくパースできた後の話のみを担当し、失敗時は400応答を返す。
export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema
): Promise<ParsedBody<z.infer<Schema>>> {
  const json: unknown = await request.json();
  const result = schema.safeParse(json);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "リクエストの内容が正しくありません";
    const responseBody: ApiResponse = { success: false, error: message };

    return { ok: false, response: Response.json(responseBody, { status: 400 }) };
  }

  return { ok: true, data: result.data };
}
