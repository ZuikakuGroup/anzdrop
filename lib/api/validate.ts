import type { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

// 通常のJSON APIに必要な入力は、最長の暗号化済みファイル名(4KiB)や
// Turnstileトークンを含めても十分に収まる。巨大な本文をrequest.json()で
// 一括展開してWorkerのメモリを消費させないため、全APIの既定上限を設ける。
export const DEFAULT_MAX_JSON_BODY_BYTES = 64 * 1024;

function payloadTooLargeResponse(): Response {
  return Response.json(
    { success: false, error: "リクエストサイズが上限を超えています" },
    { status: 413 }
  );
}

async function readBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length");

  // Content-Lengthは偽装できるため、早期拒否の最適化にだけ使い、後段の
  // ストリーム読み込みでも必ず実測値を検証する。
  if (
    /^\d+$/.test(contentLength?.trim() ?? "") &&
    Number(contentLength) > maxBytes
  ) {
    return null;
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

// リクエストボディのJSONパース失敗(不正なJSON構文)は従来どおり例外として
// 呼び出し元(withApiHandler)に伝播させ、汎用500応答にする。zodによる形状
// 検証はJSONとして正しくパースできた後の話のみを担当し、失敗時は400応答を返す。
export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<ParsedBody<z.infer<Schema>>> {
  const body = await readBodyWithinLimit(request, maxBytes);

  if (!body) {
    return { ok: false, response: payloadTooLargeResponse() };
  }

  const json: unknown = JSON.parse(new TextDecoder().decode(body));
  const result = schema.safeParse(json);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "リクエストの内容が正しくありません";
    const responseBody: ApiResponse = { success: false, error: message };

    return { ok: false, response: Response.json(responseBody, { status: 400 }) };
  }

  return { ok: true, data: result.data };
}
