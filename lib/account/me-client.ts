import type { MeResponse } from "@/app/api/account/me/schema";

// 同じ画面でヘッダーとアップロードフォームが同時に呼んでも、認証状態と
// プランの確認を1リクエストにまとめる。応答は保持しないため、SPA遷移後の
// ログイン・プラン変更が古い結果で上書きされることはない。
let mePromise: Promise<MeResponse> | undefined;

export function getCurrentAccount(): Promise<MeResponse> {
  if (!mePromise) {
    const request = fetch("/api/account/me").then(
      (response) => response.json() as Promise<MeResponse>
    );
    mePromise = request;

    request.then(
      () => {
        if (mePromise === request) {
          mePromise = undefined;
        }
      },
      () => {
        if (mePromise === request) {
          mePromise = undefined;
        }
      }
    );
  }

  return mePromise;
}
