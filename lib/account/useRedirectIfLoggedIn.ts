"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/lib/browserNavigation";
import type { MeResponse } from "@/app/api/account/me/schema";

// 既にログイン済みの場合はdestinationへリダイレクトする(ログイン/サインアップ
// 画面に再度アクセスした場合の暫定挙動)。判定が済み、リダイレクトが不要と
// わかるまではfalseを返すので、呼び出し側はその間フォームの代わりに
// 読み込み中の表示を出す。
//
// Astroの画面へフルドキュメント遷移する。Cookieは同一Originで維持される。
export function useRedirectIfLoggedIn(destination: string): boolean {
  const router = useRouter();
  const [canRenderForm, setCanRenderForm] = useState(false);

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (data.success) {
          router.replace(destination);
          return;
        }

        setCanRenderForm(true);
      })
      .catch(() => setCanRenderForm(true));
  }, [destination, router]);

  return canRenderForm;
}
