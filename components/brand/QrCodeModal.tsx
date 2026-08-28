"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { XIcon } from "./ShareIcons";

type QrCodeModalProps = {
  url: string;
  isOpen: boolean;
  onClose: () => void;
};

// QRコードはURL文字列からその場で生成するだけで、サーバーには何も送らない。
export default function QrCodeModal({ url, isOpen, onClose }: QrCodeModalProps) {
  const [svgMarkup, setSvgMarkup] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    QRCode.toString(url, { type: "svg", margin: 1 }).then((markup) => {
      if (!cancelled) {
        setSvgMarkup(markup);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, url]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="relative rounded-lg bg-paper p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
        <div
          className="h-[min(56vw,14rem)] w-[min(56vw,14rem)] [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      </div>
    </div>,
    document.body
  );
}
