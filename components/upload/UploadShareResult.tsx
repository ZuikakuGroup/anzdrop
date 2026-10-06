"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  XIcon,
  LineIcon,
  QrCodeIcon,
  ShareIcon,
} from "@/components/brand/ShareIcons";

// 共有リンクの発行後、利用者がQRボタンを押すときだけ必要になる。初回表示で
// qrcodeライブラリをダウンロード・評価しないようクライアント側で遅延読込する。
const QrCodeModal = dynamic(() => import("@/components/brand/QrCodeModal"), {
  ssr: false,
});

type UploadShareResultProps = {
  shareUrl: string;
  copyState: "idle" | "copied" | "failed";
  canShareNatively: boolean;
  isQrOpen: boolean;
  onReset: () => void;
  onCopy: () => void;
  onShareNative: () => void;
  onShareToLine: () => void;
  onOpenQr: () => void;
  onCloseQr: () => void;
};

// 共有リンク発行後の結果パネル(コピー・LINE・QR・ネイティブ共有)。
export default function UploadShareResult({
  shareUrl,
  copyState,
  canShareNatively,
  isQrOpen,
  onReset,
  onCopy,
  onShareNative,
  onShareToLine,
  onOpenQr,
  onCloseQr,
}: UploadShareResultProps) {
  const onResetRef = useRef(onReset);
  const onCloseQrRef = useRef(onCloseQr);
  // 描画中に同期し、QR を開いた直後〜 effect 前の Escape で誤って reset しないようにする。
  const isQrOpenRef = useRef(isQrOpen);
  isQrOpenRef.current = isQrOpen;
  onResetRef.current = onReset;
  onCloseQrRef.current = onCloseQr;

  // Escape で結果パネルを閉じる(×ボタンと同じ reset)。QR 表示中は先に QR だけ閉じる。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (isQrOpenRef.current) {
        onCloseQrRef.current();
        return;
      }

      onResetRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="anz-scroll relative flex h-44 flex-col items-center justify-center gap-3 overflow-y-auto rounded border-2 border-brand p-6 text-center anz-drop-enter">
      <button
        onClick={onReset}
        aria-label="閉じる"
        title="閉じる"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>

      <p className="text-xs font-bold text-ink/50">
        共有リンクを発行しました
      </p>

      <div className="flex items-center gap-3">
        {canShareNatively && (
          <button
            onClick={onShareNative}
            aria-label="共有"
            title="共有"
            className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
          >
            <ShareIcon className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onShareToLine}
          aria-label="LINEで共有"
          title="LINEで共有"
          className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
        >
          <LineIcon className="h-4 w-4" />
        </button>
        <button
          onClick={onOpenQr}
          aria-label="QRコードを表示"
          title="QRコードを表示"
          className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
        >
          <QrCodeIcon className="h-4 w-4" />
        </button>
      </div>

      <QrCodeModal
        url={shareUrl}
        isOpen={isQrOpen}
        onClose={onCloseQr}
      />

      <button
        onClick={onCopy}
        className="rounded bg-ink px-5 py-2.5 text-sm font-bold text-paper transition-colors hover:bg-ink/90"
      >
        {copyState === "copied"
          ? "コピーしました"
          : copyState === "failed"
            ? "コピーできませんでした"
            : "URLをコピー"}
      </button>
    </div>
  );
}
