"use client";

import { useEffect, useState } from "react";
import type { MeResponse } from "@/app/api/account/me/schema";

// 既にログイン済みの場合はdestinationへリダイレクトする(ログイン/サインアップ
// 画面に再度アクセスした場合の暫定挙動)。判定が済み、リダイレクトが不要と
// わかるまではfalseを返すので、呼び出し側はその間フォームの代わりに
// 読み込み中の表示を出す。
export function useRedirectIfLoggedIn(destination: string): boolean {
  const [canRenderForm, setCanRenderForm] = useState(false);

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (data.success) {
          window.location.href = destination;
          return;
        }

        setCanRenderForm(true);
      })
      .catch(() => setCanRenderForm(true));
  }, [destination]);

  return canRenderForm;
}
