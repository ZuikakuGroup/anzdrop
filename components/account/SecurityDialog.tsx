"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "@/components/brand/ShareIcons";

export default function SecurityDialog({ open, busy, title, onClose, dialogRef, restoreFocusRef, children }: {
  open: boolean;
  busy: boolean;
  title: string;
  onClose: () => void;
  dialogRef: RefObject<HTMLDialogElement | null>;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const animation = useRef<Animation | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = restoreFocusRef.current ?? document.activeElement;
    const previousOverflow = document.body.style.overflow;
    animation.current?.cancel();
    dialog.style.height = "";
    dialog.inert = false;
    if (!dialog.open) dialog.showModal();
    let height = dialog.offsetHeight;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      height = dialog.offsetHeight;
    }) : null;
    observer?.observe(dialog);
    const shouldAnimate = typeof dialog.animate === "function"
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shouldAnimate) {
      animation.current = dialog.animate(
        [{ opacity: 0, transform: "translateY(8px) scale(0.98)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
    heading.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      observer?.disconnect();
      animation.current?.cancel();
      dialog.inert = true;
      document.body.style.overflow = previousOverflow;
      const finish = () => {
        dialog.close();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      };
      if (shouldAnimate && dialog.isConnected) {
        dialog.style.height = `${height}px`;
        animation.current = dialog.animate(
          [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(4px) scale(0.99)" }],
          { duration: 120, easing: "ease-in", fill: "forwards" },
        );
        animation.current.onfinish = finish;
      } else {
        finish();
      }
    };
  }, [open, dialogRef, restoreFocusRef]);

  return <dialog ref={dialogRef} aria-labelledby="security-dialog-title" aria-modal="true"
    onCancel={(event) => { event.preventDefault(); if (open && !busy) onClose(); }}
    onClick={(event) => {
      if (!open || busy || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-ink/10 bg-paper p-6 text-ink shadow-[0_16px_64px_-24px_rgba(0,0,0,0.3)] backdrop:bg-ink/40 backdrop:backdrop-blur-xs sm:p-8">
    <div className="flex items-start justify-between gap-4">
      <h2 id="security-dialog-title" ref={heading} tabIndex={-1} className="pt-1 text-2xl font-black leading-snug tracking-normal outline-none">{title}</h2>
      <button type="button" disabled={!open || busy} onClick={onClose} aria-label="閉じる"
        className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-30"><XIcon className="h-4 w-4" /></button>
    </div>
    <div className="mt-3 space-y-6">{children}</div>
  </dialog>;
}
