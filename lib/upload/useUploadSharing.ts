import { useEffect, useRef, useState, type RefObject } from "react";
import { track } from "@/lib/analytics/client";

const SHARE_MESSAGE = "Anzdropで暗号化ファイルを共有しました";

export function useUploadSharing(shareUrl: string, analyticsTransferIdRef: RefObject<string | undefined>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [canShareNatively, setCanShareNatively] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // navigator.shareの有無はサーバー側では判定できないため、マウント後に
  // クライアントで判定する(SSRとのハイドレーション不一致を避ける)。
  useEffect(() => {
    setCanShareNatively(typeof navigator.share === "function");
  }, []);

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      track("share_link_copy", {
        analyticsTransferId: analyticsTransferIdRef.current,
      });
    } catch {
      setCopyState("failed");
    } finally {
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState("idle"), 1500);
    }
  };

  const shareToLine = () => {
    const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
      shareUrl
    )}&text=${encodeURIComponent(SHARE_MESSAGE)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareNative = async () => {
    try {
      await navigator.share({ title: SHARE_MESSAGE, url: shareUrl });
      track("share_native", {
        analyticsTransferId: analyticsTransferIdRef.current,
      });
    } catch {
      // ユーザーによるキャンセル、または非対応環境。何もしない。
    }
  };

  return { copyState, isQrOpen, setIsQrOpen, canShareNatively, handleCopy, shareToLine, shareNative,
    reset: () => { clearTimeout(copyTimer.current); setCopyState("idle"); setIsQrOpen(false); },
  };
}
