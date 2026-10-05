"use client";
import { useEffect, useRef, useState } from "react";
import { importKey, decodeBase64Url } from "@/lib/crypto";
import {
  guessPreviewMimeType,
  getPreviewKind,
  canPreviewFile,
} from "@/lib/preview";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import {
  FileGoneError,
  FriendlyError,
  shareLoadErrorFor,
  toFriendlyMessage,
} from "@/lib/download/errors";
import {
  decryptFileList,
  fetchAndDecrypt,
  unwrapKeyWithPassword,
  type DecryptedFile,
  type RawFile,
} from "@/lib/download/decrypt";
import { getShowSaveFilePicker, saveDecryptedFile } from "@/lib/download/saveFile";
import { downloadAllFiles } from "@/lib/download/downloadAll";
import {
  scheduleSendCtaOpen,
  shouldShowSendCta,
} from "@/lib/download/downloadProgress";
import {
  isSendCtaDisabled as getSendCtaDisabled,
  setSendCtaDisabled,
} from "@/lib/download/sendCtaPreference";
import { registerDownloadServiceWorker } from "@/lib/download/streamDownloadSaver";
import { track } from "@/lib/analytics/client";
import { classifyDownloadError } from "@/lib/analytics/errorCodes";
import PasswordGate from "@/components/download/PasswordGate";
import DownloadLoading from "@/components/download/DownloadLoading";
import DownloadErrorPanel from "@/components/download/DownloadErrorPanel";
import DownloadFileList from "@/components/download/DownloadFileList";
import FilePreviewModal, {
  type PreviewState,
} from "@/components/download/FilePreviewModal";
import SendCtaModal from "@/components/download/SendCtaModal";

type DownloadPageProps = {
  shareId: string;
};

type DownloadResponse = {
  success: boolean;
  share: {
    id: string;
    expires_at: string;
    wrappedKey: string | null;
    keySalt: string | null;
    previewAllowed: boolean;
  };
  files: RawFile[];
  analyticsTransferId?: string;
  error?: string;
};

const GENERIC_LOAD_ERROR =
  "ファイルの取得に失敗しました。URLが正しいかご確認のうえ、もう一度お試しください。";
const GENERIC_DOWNLOAD_ERROR =
  "ダウンロードに失敗しました。もう一度お試しください。";

export default function DownloadPage({
  shareId,
}: DownloadPageProps) {
  const [files, setFiles] = useState<DecryptedFile[]>([]);

  const [error, setError] = useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [key, setKey] = useState<CryptoKey | null>(null);

  const [downloadingId, setDownloadingId] = useState("");

  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const [previewAllowed, setPreviewAllowed] = useState(false);

  const [preview, setPreview] = useState<PreviewState | null>(null);

  const [previewLoadingId, setPreviewLoadingId] = useState("");

  const [passwordProtection, setPasswordProtection] = useState<{
    wrappedKey: string;
    keySalt: string;
    rawFiles: RawFile[];
  } | null>(null);

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);

  const analyticsTransferIdRef = useRef<string | undefined>(undefined);
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

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `/api/download/${shareId}`
        );

        const result: DownloadResponse =
          await response.json();

        if (!response.ok) {
          // ステータスごとの文言は lib/download/errors.ts に集約している
          // (UIを描画せずに対応関係をテストできるようにするため)。
          const friendly = shareLoadErrorFor(response.status);

          if (friendly) {
            throw friendly;
          }

          throw new Error(result.error ?? "ダウンロードに失敗しました");
        }

        setPreviewAllowed(result.share.previewAllowed);
        analyticsTransferIdRef.current = result.analyticsTransferId;

        if (result.share.wrappedKey && result.share.keySalt) {
          setPasswordProtection({
            wrappedKey: result.share.wrappedKey,
            keySalt: result.share.keySalt,
            rawFiles: result.files,
          });
          return;
        }

        const fragment = window.location.hash.slice(1);

        if (!fragment) {
          throw new FriendlyError(
            "このリンクには復号鍵が含まれていません。"
          );
        }

        let decryptionKey: CryptoKey;

        try {
          decryptionKey = await importKey(decodeBase64Url(fragment));
        } catch {
          throw new FriendlyError(
            "このリンクの復号鍵が正しくありません。URLが省略されていないかご確認ください。"
          );
        }

        try {
          setFiles(await decryptFileList(result.files, decryptionKey));
        } catch {
          throw new FriendlyError(
            "このリンクの復号鍵が正しくありません。URLが省略されていないかご確認ください。"
          );
        }

        setKey(decryptionKey);
      } catch (err) {
        setError(toFriendlyMessage(err, GENERIC_LOAD_ERROR));
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [shareId]);

  // プレビュー中のBlob URLを、閉じる/差し替え/アンマウント時に確実に解放する。
  useEffect(() => {
    if (!preview) {
      return;
    }

    return () => {
      URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const unlockWithPassword = async () => {
    if (!passwordProtection || isUnlocking) {
      return;
    }

    if (!passwordInput) {
      setPasswordError("パスワードを入力してください。");
      return;
    }

    setPasswordError("");
    setIsUnlocking(true);

    try {
      const decryptionKey = await unwrapKeyWithPassword(
        passwordProtection.wrappedKey,
        passwordProtection.keySalt,
        passwordInput
      );

      const decryptedFiles = await decryptFileList(
        passwordProtection.rawFiles,
        decryptionKey
      );

      setKey(decryptionKey);
      setFiles(decryptedFiles);
      setPasswordProtection(null);
    } catch {
      setPasswordError("パスワードが違います。");
    } finally {
      setIsUnlocking(false);
    }
  };

  const downloadFile = async (file: DecryptedFile) => {
    if (!key || downloadingId || isDownloadingAll || previewLoadingId) {
      return;
    }

    setDownloadingId(file.id);
    setError("");

    const attemptId = crypto.randomUUID();
    const analyticsTransferId = analyticsTransferIdRef.current;

    try {
      const startedAt = Date.now();

      track("download_start", { attemptId, analyticsTransferId });

      const { saved } = await saveDecryptedFile(file, key, file.name);

      if (!saved) {
        return;
      }

      track("download_success", {
        attemptId,
        analyticsTransferId,
        properties: { durationMs: Date.now() - startedAt },
      });
      setDownloadedFileIds((previous) => new Set(previous).add(file.id));
    } catch (err) {
      if (err instanceof FileGoneError) {
        setUnavailableFileIds((previous) => new Set(previous).add(file.id));
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
      }

      track("download_error", {
        attemptId,
        analyticsTransferId,
        properties: {
          errorCode: classifyDownloadError(err),
          errorStage: "save",
          retryCount: 0,
        },
      });

      setError(toFriendlyMessage(err, GENERIC_DOWNLOAD_ERROR));
    } finally {
      setDownloadingId("");
    }
  };

  const openPreview = async (file: DecryptedFile) => {
    if (!key || downloadingId || isDownloadingAll || previewLoadingId) {
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

    setPreviewLoadingId(file.id);
    setError("");

    try {
      const bytes = await fetchAndDecrypt(file, key);
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);

      setPreview({ file, url, kind });
    } catch (err) {
      if (err instanceof FileGoneError) {
        setUnavailableFileIds((previous) => new Set(previous).add(file.id));
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
      }

      setError(toFriendlyMessage(err, GENERIC_DOWNLOAD_ERROR));
    } finally {
      setPreviewLoadingId("");
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
  }, [downloadedFileIds, files, isSendCtaDisabled, unavailableFileIds]);

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
    if (
      !key ||
      downloadingId ||
      isDownloadingAll ||
      previewLoadingId ||
      files.length === 0
    ) {
      return;
    }

    setIsDownloadingAll(true);
    setError("");

    const removeFile = (fileId: string) => {
      setUnavailableFileIds((previous) => new Set(previous).add(fileId));
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    };

    const attemptId = crypto.randomUUID();
    const analyticsTransferId = analyticsTransferIdRef.current;

    try {
      const startedAt = Date.now();

      track("download_start", { attemptId, analyticsTransferId });

      const { cancelled, goneFileIds } = await downloadAllFiles(files, key, {
        onFileGone: removeFile,
      });

      if (cancelled) {
        return;
      }

      track("download_success", {
        attemptId,
        analyticsTransferId,
        properties: { durationMs: Date.now() - startedAt },
      });
      if (goneFileIds.length === 0) {
        setDownloadedFileIds(new Set(files.map((file) => file.id)));
      }
    } catch (err) {
      track("download_error", {
        attemptId,
        analyticsTransferId,
        properties: {
          errorCode: classifyDownloadError(err),
          errorStage: "save",
          retryCount: 0,
        },
      });

      setError(toFriendlyMessage(err, GENERIC_DOWNLOAD_ERROR));
    } finally {
      setDownloadingId("");
      setIsDownloadingAll(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-normal">
              ダウンロード
            </h1>
            <p className="text-xs text-ink/50">
              ナウでヤングな暗号化ファイル共有サービス
            </p>
          </div>

          <div className="border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            どんなファイルも簡単に共有できます。<br/>プライバシーにこだわっており、いい感じに暗号化されます。
          </div>

          <div className="space-y-5">
            {isLoading ? (
              <DownloadLoading />
            ) : passwordProtection ? (
              <PasswordGate
                passwordInput={passwordInput}
                passwordError={passwordError}
                onPasswordChange={setPasswordInput}
                onSubmit={unlockWithPassword}
              />
            ) : error ? (
              <DownloadErrorPanel
                error={error}
                onDismiss={() => setError("")}
              />
            ) : (
              <DownloadFileList
                files={files}
                previewAllowed={previewAllowed}
                downloadingId={downloadingId}
                isDownloadingAll={isDownloadingAll}
                previewLoadingId={previewLoadingId}
                onDownload={downloadFile}
                onPreview={openPreview}
              />
            )}

            <button
              onClick={passwordProtection ? unlockWithPassword : downloadAll}
              disabled={
                passwordProtection
                  ? isUnlocking
                  : isLoading ||
                  !!error ||
                  files.length === 0 ||
                  isDownloadingAll ||
                  !!downloadingId
              }
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {(passwordProtection ? isUnlocking : isDownloadingAll) && (
                <Spinner className="h-4 w-4 text-paper" />
              )}
              {passwordProtection
                ? isUnlocking
                  ? "確認中..."
                  : "開く"
                : isDownloadingAll
                  ? "ダウンロード中..."
                  : "全てダウンロード"}
            </button>

          </div>
        </div>
      </main>

      <SiteFooter reportShareId={shareId} />

      {preview && (
        <FilePreviewModal preview={preview} onClose={closePreview} />
      )}

      {isSendCtaOpen && (
        <SendCtaModal
          isSendCtaDisabled={isSendCtaDisabled}
          onClose={() => setIsSendCtaOpen(false)}
          onCtaClick={handleSendCtaClick}
          onDisabledChange={handleSendCtaDisabledChange}
        />
      )}
    </div>
  );
}
