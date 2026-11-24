import { useEffect, useId, useRef } from "react";
import { XIcon } from "@/components/brand/ShareIcons";
import type { PreviewKind } from "@/lib/preview";
import type { DecryptedFile } from "@/lib/download/decrypt";

export type PreviewState = {
  file: DecryptedFile;
  url: string;
  kind: PreviewKind;
  trigger?: HTMLElement;
};

type FilePreviewModalProps = {
  preview: PreviewState;
  onClose: () => void;
};

// ブラウザ内プレビュー(画像・音声・動画)のモーダル。Blob URL の寿命は親が管理する。
export default function FilePreviewModal({
  preview,
  onClose,
}: FilePreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = preview.trigger ?? document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [preview.trigger]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg border border-ink/10 bg-paper p-4 text-ink backdrop:bg-ink/70"
    >
      {/* Keep Tab inside the preview, including native audio/video controls. */}
      <span
        tabIndex={0}
        aria-hidden="true"
        className="pointer-events-none fixed h-px w-px overflow-hidden opacity-0"
        onFocus={() => {
          const media = dialogRef.current?.querySelector<HTMLMediaElement>("audio[controls], video[controls]");
          (media ?? closeRef.current)?.focus();
        }}
      />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        title="閉じる"
        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded text-ink/60 transition-colors hover:bg-ink/[0.06] hover:text-ink"
      >
        <XIcon className="h-4 w-4" />
      </button>

      <p id={titleId} className="mb-3 truncate pr-10 text-sm font-bold">
        {preview.file.name}
      </p>

      {preview.kind === "video" && (
        <video
          src={preview.url}
          controls
          autoPlay
          className="max-h-[70vh] w-full rounded"
        />
      )}
      {preview.kind === "audio" && (
        <audio src={preview.url} controls autoPlay className="w-full" />
      )}
      {preview.kind === "image" && (
        <img
          src={preview.url}
          alt={preview.file.name}
          className="max-h-[70vh] w-full rounded object-contain"
        />
      )}
      <span
        tabIndex={0}
        aria-hidden="true"
        className="pointer-events-none fixed h-px w-px overflow-hidden opacity-0"
        onFocus={() => closeRef.current?.focus()}
      />
    </dialog>
  );
}
