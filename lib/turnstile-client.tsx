"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// SSR時とハイドレーション直後の初回クライアントレンダーで出力を一致させつつ、
// マウント完了後だけtrueを返すためのおまじない(値は変化しないため購読は不要)。
const noopSubscribe = () => () => {};
const getIsMountedSnapshot = () => true;
const getIsMountedServerSnapshot = () => false;

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
          "before-interactive-callback"?: () => void;
          "after-interactive-callback"?: () => void;
        }
      ) => string;
      execute: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

// Turnstileウィジェットの取得・実行をまとめたフック。フォーム側は
// JSXツリーのどこかに{widget}を配置し、送信直前にgetToken()を呼ぶだけでよい。
// appearance: "interaction-only" は、Cloudflareが実際にチャレンジ表示が
// 必要と判断した場合のみウィジェットを表示する(正規ユーザーには通常何も見えない)。
// チャレンジ表示が必要になった場合は、before/after-interactive-callbackを使って
// ページ内埋め込みではなくモーダルオーバーレイとして見せる。
export function useTurnstile(): { getToken: () => Promise<string>; widget: ReactNode } {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const resolveRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  const [isInteractive, setIsInteractive] = useState(false);
  // portal(document.body依存)の描画はマウント完了後まで遅らせる。
  const isMounted = useSyncExternalStore(
    noopSubscribe,
    getIsMountedSnapshot,
    getIsMountedServerSnapshot
  );

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
        setIsInteractive(false);
        const reject = rejectRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        reject?.(
          new Error(`Bot対策の検証に失敗しました(${errorCode})。`)
        );
      },
      "expired-callback": () => {
        setIsInteractive(false);
        const reject = rejectRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        reject?.(
          new Error(
            "Bot対策の検証がタイムアウトしました。もう一度お試しください。"
          )
        );
      },
      "before-interactive-callback": () => setIsInteractive(true),
      "after-interactive-callback": () => setIsInteractive(false),
    });

    widgetIdRef.current = widgetId;
    return widgetId;
  };

  // ウィジェットのrender()(Cloudflare側のiframe初期化を伴う)を、送信ボタン
  // クリックまで遅延させず、マウント後(turnstile.jsの読み込み待ちを挟みつつ)
  // 先行して行っておく。こうすることで送信時にgetToken()から呼ばれる
  // ensureWidget()は既にレンダリング済みのwidgetIdを即座に返すだけになり、
  // execute()の呼び出しだけが送信時の待ち時間として残る。
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !isMounted) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const tryRender = () => {
      if (cancelled) {
        return;
      }

      if (window.turnstile) {
        ensureWidget();
        return;
      }

      timeoutId = setTimeout(tryRender, 100);
    };

    tryRender();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isMounted]);

  // モーダル表示中は背景のスクロールを止める(オーバーレイはクリックを
  // 吸収するが、タッチ操作によるスクロールまでは防げないため)。
  useEffect(() => {
    if (!isInteractive) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isInteractive]);

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

  // ウィジェット自体は常にDOM上の同じ要素にレンダリングし続ける必要があるため
  // (別要素へ差し替えるとTurnstile側のiframeが失われる)、表示状態に応じて
  // 外側のオーバーレイの見た目だけを切り替える。非表示中はopacity/pointer-events
  // で隠すのみで、display:noneやアンマウントはしない。
  const widget =
    isMounted
      ? createPortal(
          <div
            className={
              isInteractive
                ? "fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs"
                : "pointer-events-none fixed inset-0 z-50 opacity-0"
            }
          >
            <div ref={containerRef} />
          </div>,
          document.body
        )
      : null;

  return { getToken, widget };
}
