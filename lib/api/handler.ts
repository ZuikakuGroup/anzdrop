import type { ApiResponse } from "@/lib/api/response";

const INTERNAL_SERVER_ERROR_RESPONSE: ApiResponse = {
  success: false,
  error: "サーバー内部でエラーが発生しました",
};

// server/routes/**/route.tsの全ハンドラーで手作業コピーされていた
// 「try { ... } catch { console.error(...); 汎用500応答 }」の定型を
// まとめる。routeLabelはログの先頭に出す識別子(例: "GET /api/account/me")で、
// 例外本文には入力・トークンが含まれうるため、ログには固定のラベルだけを残す。
export function withApiHandler<Args extends unknown[]>(
  routeLabel: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch {
      console.error(`${routeLabel} failed`);

      return Response.json(INTERNAL_SERVER_ERROR_RESPONSE, { status: 500 });
    }
  };
}
