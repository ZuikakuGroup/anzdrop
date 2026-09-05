"use client";
import { useEffect, useState } from "react";
import { importKey, decodeBase64Url } from "@/lib/crypto";
import { formatBytes } from "@/lib/format";
import {
  guessPreviewMimeType,
  getPreviewKind,
  canPreviewFile,
  type PreviewKind,
} from "@/lib/preview";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import { XIcon, EyeIcon } from "@/components/brand/ShareIcons";
import PasswordInput from "@/components/brand/PasswordInput";
import {
  FileGoneError,
  FriendlyError,
  NON_DISMISSIBLE_ERRORS,
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
import { registerDownloadServiceWorker } from "@/lib/download/streamDownloadSaver";

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
  error?: string;
};

type PreviewState = {
  file: DecryptedFile;
  url: string;
  kind: PreviewKind;
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

    try {
      await saveDecryptedFile(file, key, file.name);
    } catch (err) {
      if (err instanceof FileGoneError) {
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
      }

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
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
      }

      setError(toFriendlyMessage(err, GENERIC_DOWNLOAD_ERROR));
    } finally {
      setPreviewLoadingId("");
    }
  };

  const closePreview = () => setPreview(null);

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

    const removeFile = (fileId: string) =>
      setFiles((prev) => prev.filter((f) => f.id !== fileId));

    try {
      await downloadAllFiles(files, key, { onFileGone: removeFile });
    } catch (err) {
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
              <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center">
                <Spinner className="mb-1 h-6 w-6 text-brand" />
                <span className="text-xs font-bold text-ink/50">
                  読み込み中...
                </span>
              </div>
            ) : passwordProtection ? (
              <div className="anz-scroll flex h-40 flex-col justify-center gap-2 overflow-y-auto rounded border-2 border-ink p-6">
                <span className="text-sm font-bold text-ink/50">
                  パスワードで保護されています
                </span>
                <PasswordInput
                  value={passwordInput}
                  onChange={setPasswordInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      unlockWithPassword();
                    }
                  }}
                  placeholder="パスワード"
                  autoComplete="current-password"
                  className="w-full rounded border-2 border-ink/20 py-3.5 pl-4 pr-10 text-base outline-none focus:border-brand sm:text-sm"
                />
                <p className="min-h-[17px] text-sm font-bold text-brand">
                  {passwordError}
                </p>
              </div>
            ) : error ? (
              <div className="relative flex h-40 flex-col items-center justify-center gap-2 rounded border-2 border-brand p-6 text-center">
                {!NON_DISMISSIBLE_ERRORS.has(error) && (
                  <button
                    onClick={() => setError("")}
                    aria-label="閉じる"
                    title="閉じる"
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                <p className="text-sm font-bold text-brand">{error}</p>
              </div>
            ) : (
              <ul className="anz-scroll h-40 divide-y divide-ink/10 overflow-y-auto rounded border-2 border-ink p-2 text-[13px]">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-1">
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={
                        downloadingId === file.id ||
                        isDownloadingAll ||
                        !!previewLoadingId
                      }
                      className="flex min-w-0 flex-1 items-center justify-between gap-4 px-2 py-2 text-left transition-colors hover:bg-ink/[0.03] disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      {downloadingId === file.id ? (
                        <Spinner className="h-4 w-4 shrink-0 text-brand" />
                      ) : (
                        <span className="shrink-0 font-bold text-ink/40">
                          {formatBytes(file.size)}
                        </span>
                      )}
                    </button>

                    {canPreviewFile({
                      shareAllowsPreview: previewAllowed,
                      isOneTimeFile: file.isOneTime,
                      filename: file.name,
                    }) && (
                      <button
                        onClick={() => openPreview(file)}
                        disabled={
                          downloadingId === file.id ||
                          isDownloadingAll ||
                          !!previewLoadingId
                        }
                        aria-label="プレビュー"
                        title="プレビュー"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
                      >
                        {previewLoadingId === file.id ? (
                          <Spinner className="h-4 w-4 text-brand" />
                        ) : (
                          <EyeIcon className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="relative max-h-[90vh] w-full max-w-2xl rounded-lg bg-paper p-4">
            <button
              onClick={closePreview}
              aria-label="閉じる"
              title="閉じる"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <XIcon className="h-4 w-4" />
            </button>

            <p className="mb-3 truncate pr-10 text-sm font-bold">
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
              // eslint-disable-next-line @next/next/no-img-element -- blob: URLの表示なのでnext/imageの最適化対象外
              <img
                src={preview.url}
                alt={preview.file.name}
                className="max-h-[70vh] w-full rounded object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
