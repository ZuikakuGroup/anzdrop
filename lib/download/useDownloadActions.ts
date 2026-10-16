import { useEffect, useRef, useState } from "react";
import { guessPreviewMimeType, getPreviewKind, canPreviewFile } from "@/lib/preview";
import { FileGoneError, toFriendlyMessage } from "./errors";
import { fetchAndDecrypt, type DecryptedFile } from "./decrypt";
import { getShowSaveFilePicker, saveDecryptedFile } from "./saveFile";
import { downloadAllFiles } from "./downloadAll";
import { scheduleSendCtaOpen, shouldShowSendCta } from "./downloadProgress";
import { isSendCtaDisabled as getSendCtaDisabled, setSendCtaDisabled } from "./sendCtaPreference";
import { registerDownloadServiceWorker } from "./streamDownloadSaver";
import { track } from "@/lib/analytics/client";
import { classifyDownloadError } from "@/lib/analytics/errorCodes";
import type { PreviewState } from "@/components/download/FilePreviewModal";
import type { useSharedFiles } from "./useSharedFiles";

const GENERIC_DOWNLOAD_ERROR = "ダウンロードに失敗しました。もう一度お試しください。";

export function useDownloadActions({ files, setFiles, key, previewAllowed, setError, analyticsTransferIdRef }: ReturnType<typeof useSharedFiles>) {
  const [downloadingId, setDownloadingId] = useState("");
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState("");
  const [downloadedFileIds, setDownloadedFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const [unavailableFileIds, setUnavailableFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isSendCtaOpen, setIsSendCtaOpen] = useState(false);
  const [isSendCtaDisabled, setIsSendCtaDisabled] = useState(
    getSendCtaDisabled
  );
  const ctaViewTrackedRef = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // showSaveFilePicker が使えないブラウザ(Firefox/Safari)向けに、
  // 大容量ファイルをメモリに載せずに保存するための Service Worker を登録する
  // (GitHub issue #61)。失敗しても Blob フォールバックがあるので無視でよい。
  // showSaveFilePicker が使える環境(Chromium 系)は SW 経路を使わないため
  // 登録しない(全 fetch に介入する SW の常駐を最小限にする)。
  useEffect(() => {
    if (!getShowSaveFilePicker()) {
      registerDownloadServiceWorker();
    }
  }, []);

  // プレビュー中のBlob URLを、閉じる/差し替え/アンマウント時に確実に解放する。
  useEffect(() => {
    if (!preview) {
      return;
    }

    return () => {
      URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const removeFile = (fileId: string) => {
    setUnavailableFileIds((previous) => new Set(previous).add(fileId));
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Saving starts synchronously inside the user gesture (required by file pickers).
  const runDownload = async (save: (success: () => void) => Promise<void>, file?: DecryptedFile) => {
    busy.current = true;
    setError("");
    const attemptId = crypto.randomUUID();
    const analyticsTransferId = analyticsTransferIdRef.current;
    const startedAt = Date.now();
    track("download_start", { attemptId, analyticsTransferId });
    try {
      await save(success);
    } catch (error) {
      if (mounted.current) {
        if (file && error instanceof FileGoneError) removeFile(file.id);
        setError(toFriendlyMessage(error, GENERIC_DOWNLOAD_ERROR));
      }
      track("download_error", { attemptId, analyticsTransferId, properties: {
        errorCode: classifyDownloadError(error), errorStage: "save", retryCount: 0,
      } });
    } finally {
      busy.current = false;
      if (mounted.current) { setDownloadingId(""); setIsDownloadingAll(false); }
    }
    function success() {
      track("download_success", { attemptId, analyticsTransferId, properties: { durationMs: Date.now() - startedAt } });
    }
  };

  const downloadFile = async (file: DecryptedFile) => {
    if (!key || busy.current) return;
    setDownloadingId(file.id);
    await runDownload(async success => {
      const { saved } = await saveDecryptedFile(file, key, file.name);
      if (!saved) return;
      success();
      if (mounted.current) setDownloadedFileIds(previous => new Set(previous).add(file.id));
    }, file);
  };

  const openPreview = async (file: DecryptedFile) => {
    if (!key || busy.current) {
      return;
    }

    // ボタンの表示条件と同じチェックをここでも行う(念のための二重防御)。
    // 保存期間「1回」のファイルは、/api/file/[fileId]の1回限りの
    // ダウンロード枠を誤って消費してしまわないよう、呼び出し経路が
    // 将来増えても必ずここで止まるようにする。
    if (
      !canPreviewFile({
        shareAllowsPreview: previewAllowed,
        isOneTimeFile: file.isOneTime,
        filename: file.name,
      })
    ) {
      return;
    }

    const mimeType = guessPreviewMimeType(file.name);
    const kind = mimeType ? getPreviewKind(mimeType) : null;

    if (!mimeType || !kind) {
      return;
    }

    busy.current = true;
    setPreviewLoadingId(file.id);
    setError("");

    try {
      const bytes = await fetchAndDecrypt(file, key);
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);

      if (mounted.current) setPreview({ file, url, kind });
      else URL.revokeObjectURL(url);
    } catch (err) {
      if (mounted.current) {
        if (err instanceof FileGoneError) removeFile(file.id);
        setError(toFriendlyMessage(err, GENERIC_DOWNLOAD_ERROR));
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPreviewLoadingId("");
    }
  };

  const closePreview = () => setPreview(null);

  // 要件書10.12・29章。受け取り側から送信側への転換導線(Growth Loop)を
  // 計測する。ブラウザの保存UIを妨げないよう少し待ってモーダルを表示し、
  // 実際に表示する時点で1回だけ計測する。
  useEffect(() => {
    if (
      shouldShowSendCta(
        files,
        downloadedFileIds,
        unavailableFileIds,
        isSendCtaDisabled
      ) &&
      !ctaViewTrackedRef.current
    ) {
      return scheduleSendCtaOpen(() => {
        ctaViewTrackedRef.current = true;
        setIsSendCtaOpen(true);
        track("recipient_send_cta_view", {
          analyticsTransferId: analyticsTransferIdRef.current,
        });
      });
    }
  }, [downloadedFileIds, files, isSendCtaDisabled, unavailableFileIds, analyticsTransferIdRef]);

  const handleSendCtaClick = () => {
    track("recipient_send_cta_click", {
      analyticsTransferId: analyticsTransferIdRef.current,
    });
  };

  const handleSendCtaDisabledChange = (disabled: boolean) => {
    setIsSendCtaDisabled(disabled);
    setSendCtaDisabled(disabled);
  };

  const downloadAll = async () => {
    if (!key || busy.current || files.length === 0) return;
    setIsDownloadingAll(true);
    await runDownload(async success => {
      const { cancelled, goneFileIds } = await downloadAllFiles(files, key, {
        onFileGone: id => { if (mounted.current) removeFile(id); },
      });
      if (cancelled) return;
      success();
      if (mounted.current && goneFileIds.length === 0) {
        setDownloadedFileIds(new Set(files.map(file => file.id)));
      }
    });
  };

  return { downloadingId, isDownloadingAll, preview, previewLoadingId, downloadFile,
    openPreview, closePreview, downloadAll, isSendCtaOpen, setIsSendCtaOpen,
    isSendCtaDisabled, handleSendCtaClick, handleSendCtaDisabledChange };
}
