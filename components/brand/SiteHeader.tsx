"use client";

import { useEffect, useState } from "react";
import BrandHeader from "./BrandHeader";
import type { MeResponse } from "@/app/api/account/me/schema";

export default function SiteHeader() {
  const [accountId, setAccountId] = useState<string | null>(null);
  // ログイン確認中は、未ログイン用のボタンがログイン中の一瞬だけ
  // ちらつくのを防ぐため、確認が終わるまでどちらも表示しない。
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (data.success) {
          setAccountId(data.accountId);
        }
      })
      .catch(() => {})
      .finally(() => setIsAuthChecked(true));
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await fetch("/api/account/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink/10 bg-paper px-6 sm:px-8">
      <BrandHeader />

      <div className="flex items-center gap-4">
        {isAuthChecked && (accountId ? (
          <div className="flex items-center gap-2">
            <a
              href="/billing"
              className="font-mono text-xs text-ink/60 transition-colors hover:text-ink"
            >
              {accountId}
            </a>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="rounded border border-ink/20 px-2 py-1 text-[11px] font-bold text-ink/60 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs font-bold">
            <a
              href="/login"
              className="text-ink/60 transition-colors hover:text-ink"
            >
              ログイン
            </a>
            <a
              href="/signup"
              className="rounded bg-brand px-3 py-1.5 text-paper transition-colors hover:bg-brand/90"
            >
              アカウント作成
            </a>
          </div>
        ))}
      </div>
    </header>
  );
}
