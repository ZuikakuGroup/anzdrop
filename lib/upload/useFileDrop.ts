import { useRef, useState, type DragEvent } from "react";
import type { PendingFile } from "./dragDropFiles";

export function useFileDrop(addFiles: (files: PendingFile[]) => void, setError: (error: string) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current--;

    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(event.dataTransfer.files);
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry);

    void import("@/lib/upload/dragDropFiles")
      .then(({ collectDataTransferFiles }) =>
        collectDataTransferFiles(files, entries)
      )
      .then(addFiles)
      .catch(() => setError("ファイルの読み込みに失敗しました。"));
  };

  return { isDragging, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
