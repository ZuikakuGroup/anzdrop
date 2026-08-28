"use client";

import { useEffect, useRef, useState } from "react";
import BrandHeader from "./BrandHeader";
import type { MeResponse } from "@/app/api/account/me/schema";

export default function SiteHeader() {
  const [accountId, setAccountId] = useState<string | null>(null);
  // ログイン確認中は、未ログイン用のボタンがログイン中の一瞬だけ
  // ちらつくのを防ぐため、確認が終わるまでどちらも表示しない。
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

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
    <header className="flex h-16 shrink-0 items-center border-b border-ink/10 bg-paper px-6 sm:px-8">
      <div className="flex flex-1 items-center">
        <BrandHeader />
      </div>

      <nav className="flex flex-1 justify-center text-xs font-bold">
        <a
          href="/pricing"
          className="text-ink/60 transition-colors hover:text-ink"
        >
          料金プラン
        </a>
      </nav>

      <div className="flex flex-1 items-center justify-end gap-4">
        {isAuthChecked && (accountId ? (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setIsMenuOpen((open) => !open)}
              className="font-mono text-xs text-ink/60 transition-colors hover:text-ink"
            >
              {accountId}
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 rounded border border-ink/10 bg-paper py-1 shadow-lg">
                <a
                  href="/mypage/billing"
                  className="block px-3 py-2 text-xs text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  プラン・お支払い
                </a>
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="block w-full px-3 py-2 text-left text-xs text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40"
                >
                  ログアウト
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs font-bold">
            <a
              href="/mypage/login"
              className="text-ink/60 transition-colors hover:text-ink"
            >
              ログイン
            </a>
            <a
              href="/mypage/signup"
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
