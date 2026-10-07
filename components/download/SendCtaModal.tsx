/* eslint-disable @next/next/no-html-link-for-pages -- Astro islands navigate using full documents. */
import { useEffect, useRef } from "react";
import { XIcon } from "@/components/brand/ShareIcons";

type SendCtaModalProps = {
  isSendCtaDisabled: boolean;
  onClose: () => void;
  onCtaClick: () => void;
  onDisabledChange: (disabled: boolean) => void;
};

// 受け取り完了後の送信導線モーダル。フォーカストラップと Escape 閉じも含む。
export default function SendCtaModal({
  isSendCtaDisabled,
  onClose,
  onCtaClick,
  onDisabledChange,
}: SendCtaModalProps) {
  const sendCtaCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sendCtaDisableCheckboxRef = useRef<HTMLInputElement>(null);
  // 親のインライン onClose が毎レンダー変わっても、マウント時一度きりの
  // フォーカストラップを張り直さない(開閉時だけマウントされる前提)。
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    sendCtaCloseButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };

    const keepFocusInModal = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const closeButton = sendCtaCloseButtonRef.current;
      const disableCheckbox = sendCtaDisableCheckboxRef.current;

      if (!closeButton || !disableCheckbox) {
        return;
      }

      if (event.shiftKey && document.activeElement === closeButton) {
        event.preventDefault();
        disableCheckbox.focus();
      } else if (!event.shiftKey && document.activeElement === disableCheckbox) {
        event.preventDefault();
        closeButton.focus();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("keydown", keepFocusInModal);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("keydown", keepFocusInModal);
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-cta-title"
        className="relative w-full max-w-md rounded-xl bg-paper p-8 text-center sm:p-10"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={sendCtaCloseButtonRef}
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <XIcon className="h-4 w-4" />
        </button>
        <h2 id="send-cta-title" className="text-xl font-black">
          ダウンロードが完了しました
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/60">
          Anzdropなら、あなたもかんたんにファイルを送れます。
        </p>
        <a
          href="/"
          onClick={onCtaClick}
          className="mt-7 inline-flex items-center justify-center rounded bg-brand px-5 py-2.5 text-xs font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
        >
          Anzdropでファイルを送る
        </a>
        <label className="mt-5 flex items-center justify-center gap-2 text-xs text-ink/60">
          <input
            ref={sendCtaDisableCheckboxRef}
            type="checkbox"
            checked={isSendCtaDisabled}
            onChange={(event) =>
              onDisabledChange(event.target.checked)
            }
            className="h-4 w-4 accent-brand"
          />
          次から表示しない
        </label>
      </div>
    </div>
  );
}
