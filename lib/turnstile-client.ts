"use client";

import { useRef } from "react";

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          appearance?: "always" | "execute" | "interaction-only";
          execution?: "render" | "execute";
          callback?: (token: string) => void;
          "error-callback"?: (errorCode: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      execute: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

// Turnstileウィジェットの取得・実行をまとめたフック。フォーム側は
// containerRefをコンテナ要素に渡し、送信直前にgetToken()を呼ぶだけでよい。
// appearance: "interaction-only" は、Cloudflareが実際にチャレンジ表示が
// 必要と判断した場合のみウィジェットを表示する(正規ユーザーには通常何も見えない)。
export function useTurnstile() {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const resolveRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);

  const ensureWidget = (): string | null => {
    if (!window.turnstile || !containerRef.current) {
      return null;
    }

    if (widgetIdRef.current) {
      return widgetIdRef.current;
    }

    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      execution: "execute",
      callback: (token) => {
        const resolve = resolveRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        resolve?.(token);
      },
      "error-callback": (errorCode) => {
        const reject = rejectRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        reject?.(
          new Error(`Bot対策の検証に失敗しました(${errorCode})。`)
        );
      },
      "expired-callback": () => {
        const reject = rejectRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        reject?.(
          new Error(
            "Bot対策の検証がタイムアウトしました。もう一度お試しください。"
          )
        );
      },
    });

    widgetIdRef.current = widgetId;
    return widgetId;
  };

  const getToken = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!TURNSTILE_SITE_KEY) {
        reject(new Error("Bot対策が設定されていません。"));
        return;
      }

      const widgetId = ensureWidget();

      if (!widgetId || !window.turnstile) {
        reject(
          new Error(
            "Bot対策の読み込みに失敗しました。ページを再読み込みしてください。"
          )
        );
        return;
      }

      resolveRef.current = resolve;
      rejectRef.current = reject;
      window.turnstile.execute(widgetId);
    });
  };

  return { containerRef, getToken };
}
