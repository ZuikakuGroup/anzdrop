"use client";

import { useEffect, useRef, useState } from "react";
import BrandHeader from "./BrandHeader";
import { ChevronIcon, MenuIcon, XIcon } from "./ShareIcons";
import type { MeResponse } from "@/app/api/account/me/schema";

const NAV_LINKS = [
  { href: "/about", label: "Anzdropとは" },
  { href: "/pricing", label: "料金プラン" },
];

export default function SiteHeader() {
  const [accountId, setAccountId] = useState<string | null>(null);
  // ログイン確認中は、未ログイン用のボタンがログイン中の一瞬だけ
  // ちらつくのを防ぐため、確認が終わるまでどちらも表示しない。
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center border-b border-ink/10 bg-paper px-6 sm:px-8">
      <div className="flex flex-1 items-center">
        <BrandHeader />
      </div>

      <nav className="hidden flex-1 justify-center gap-6 text-xs font-bold md:flex">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="text-ink/60 transition-colors hover:text-ink"
          >
            {link.label}
          </a>
        ))}
      </nav>

      <div className="hidden flex-1 items-center justify-end gap-4 md:flex">
        {isAuthChecked && (accountId ? (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setIsMenuOpen((open) => !open)}
              className="flex items-center gap-1 rounded px-2 py-1.5 font-mono text-xs text-ink/60 transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <ChevronIcon
                className={`h-3 w-3 shrink-0 transition-transform duration-300 ${
                  isMenuOpen ? "rotate-180" : ""
                }`}
              />
              {accountId}
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 rounded border border-ink/10 bg-paper py-1 shadow-lg">
                <a
                  href="/mypage"
                  className="block px-3 py-2 text-xs text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  マイページ
                </a>
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

      <div className="flex flex-1 justify-end md:hidden">
        <button
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-label={isMobileMenuOpen ? "メニューを閉じる" : "メニューを開く"}
          className="rounded p-1.5 text-ink/60 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          {isMobileMenuOpen ? (
            <XIcon className="h-5 w-5" />
          ) : (
            <MenuIcon className="h-5 w-5" />
          )}
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="absolute left-0 right-0 top-full z-10 space-y-4 border-b border-ink/10 bg-paper p-6 shadow-lg md:hidden">
          <nav className="flex flex-col gap-3 text-sm font-bold">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-ink/70 transition-colors hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="space-y-3 border-t border-ink/10 pt-4 text-sm font-bold">
            {isAuthChecked && (accountId ? (
              <>
                <a
                  href="/mypage"
                  className="block font-mono text-ink/70 transition-colors hover:text-ink"
                >
                  {accountId}
                </a>
                <a
                  href="/mypage/billing"
                  className="block text-ink/70 transition-colors hover:text-ink"
                >
                  プラン・お支払い
                </a>
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="block text-left text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
                >
                  ログアウト
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <a
                  href="/mypage/login"
                  className="text-ink/70 transition-colors hover:text-ink"
                >
                  ログイン
                </a>
                <a
                  href="/mypage/signup"
                  className="inline-block w-fit rounded bg-brand px-3 py-1.5 text-paper transition-colors hover:bg-brand/90"
                >
                  アカウント作成
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
