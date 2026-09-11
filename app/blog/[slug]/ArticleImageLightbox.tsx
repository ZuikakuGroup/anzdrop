"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/components/brand/ShareIcons";
import styles from "./ArticleImageLightbox.module.css";

type PreviewImage = { src: string; alt: string };

function imageFromTarget(target: EventTarget | null): PreviewImage | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const image = target.closest<HTMLImageElement>("img[data-zoomable-image]")
    ?? target.closest<HTMLElement>("[data-zoomable-trigger]")?.querySelector<HTMLImageElement>("img[data-zoomable-image]");
  return image ? { src: image.currentSrc || image.src, alt: image.alt } : null;
}

export default function ArticleImageLightbox({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<PreviewImage | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const close = useCallback(() => {
    restoreFocusRef.current = true;
    setIsOpen(false);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setImage(null);
    }, reducedMotion ? 0 : 160);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!image) {
      if (restoreFocusRef.current) {
        triggerRef.current?.focus();
        restoreFocusRef.current = false;
      }
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, image]);

  const open = (targetImage: PreviewImage, trigger: Element) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    triggerRef.current = trigger.closest<HTMLElement>("button") ?? (trigger as HTMLElement);
    setImage(targetImage);
    setIsOpen(true);
  };

  const openFromClick = (event: MouseEvent<HTMLDivElement>) => {
    const targetImage = imageFromTarget(event.target);
    if (targetImage) {
      event.preventDefault();
      open(targetImage, event.target as Element);
    }
  };

  const openFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const targetImage = imageFromTarget(event.target);
    if (targetImage) {
      event.preventDefault();
      open(targetImage, event.target as Element);
    }
  };

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
    if (!focusable?.length) {
      return;
    }

    event.preventDefault();
    (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
  };

  return (
    <>
      <div onClick={openFromClick} onKeyDown={openFromKeyboard}>{children}</div>
      {image && createPortal(
        <div data-testid="image-lightbox-overlay" className={`fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-xs ${isOpen ? styles.overlay : styles.overlayClosing}`} onClick={close}>
          <div ref={dialogRef} className={`relative max-h-full max-w-full ${styles.dialog}`} role="dialog" aria-modal="true" aria-label={image.alt || "画像の拡大表示"} onClick={(event) => event.stopPropagation()} onKeyDown={trapFocus}>
            <button ref={closeButtonRef} type="button" onClick={close} aria-label="閉じる" className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-paper/90 text-ink shadow transition-colors hover:bg-paper">
              <XIcon className="h-4 w-4" />
            </button>
            {/* microCMSの画像CDNだけをサーバー側で許可しているため、ここでもブラウザが実際に表示している画像URLを使う。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt={image.alt} className={`${styles.image} rounded-lg object-contain shadow-2xl`} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
