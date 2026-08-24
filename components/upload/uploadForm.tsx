"use client";

import { useId, useRef, useState } from "react";
import Script from "next/script";
import {
  generateKey,
  exportKey,
  encryptChunk,
  packChunk,
  encodeBase64Url,
  iterateEncryptedChunks,
  generateSalt,
  deriveKeyFromPassword,
} from "@/lib/crypto";
import { CHUNK_SIZE } from "@/lib/crypto/types";
import { MAX_FILE_SIZE_BYTES } from "@/lib/limits";
import type { Retention } from "@/lib/retention";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import DropMark from "@/components/brand/DropMark";
import Spinner from "@/components/brand/Spinner";
import {
  XIcon,
  InstagramIcon,
  LineIcon,
  ChevronIcon,
} from "@/components/brand/ShareIcons";
import { formatBytes } from "@/lib/format";

const SHARE_MESSAGE = "Anzdropで暗号化ファイルを共有しました";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          appearance?: "always" | "execute" | "interaction-only";
          execution?: "render" | "execute";
          callback?: (token: string) => void;
          "error-callback"?: (errorCode: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      execute: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

const RETENTION_OPTIONS: { value: Retention; label: string }[] = [
  { value: "once", label: "1回" },
  { value: "1d", label: "1日" },
  { value: "3d", label: "3日" },
  { value: "7d", label: "7日" },
];

type UploadStartResponse = {
  success: boolean;
  shareId?: string;
  uploadToken?: string;
  uploadSessionId?: string;
  expiresAt?: string;
  error?: string;
};

type UploadCompleteResponse = {
  success: boolean;
  fileId?: string;
  error?: string;
};

async function encryptFileName(
  name: string,
  key: CryptoKey
): Promise<string> {
  const nameBytes = new TextEncoder().encode(name);
  const encrypted = await encryptChunk(nameBytes, key);
  const packed = packChunk(encrypted);

  return encodeBase64Url(packed);
}

const CHUNK_UPLOAD_CONCURRENCY = 4;

// パート番号はR2のマルチパートアップロード上で順不同に受け付けられるため、
// チャンクを並列アップロードして1ラウンドトリップあたりの待ち時間を隠す。
async function uploadChunksConcurrently(
  chunks: Uint8Array[],
  uploadSessionId: string,
  path: string,
  onChunkUploaded: () => void
): Promise<void> {
  let nextIndex = 0;
  let firstError: Error | null = null;

  const worker = async (): Promise<void> => {
    while (firstError === null) {
      const index = nextIndex++;

      if (index >= chunks.length) {
        return;
      }

      const chunk = chunks[index];
      const partNumber = index + 1;
      const body = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ) as ArrayBuffer;

      try {
        const chunkResponse = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Anzdrop-Upload-Session": uploadSessionId,
            "Anzdrop-Part-Number": String(partNumber),
          },
          body,
        });

        if (!chunkResponse.ok) {
          throw new Error(
            `${path} のチャンク ${partNumber} アップロードに失敗しました`
          );
        }

        onChunkUploaded();
      } catch (unknownErr) {
        firstError =
          unknownErr instanceof Error
            ? unknownErr
            : new Error("Unknown error");
        return;
      }
    }
  };

  const workerCount = Math.min(CHUNK_UPLOAD_CONCURRENCY, chunks.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  if (firstError) {
    throw firstError;
  }
}

async function wrapKeyWithPassword(
  key: CryptoKey,
  password: string
): Promise<{ wrappedKey: string; keySalt: string }> {
  const salt = generateSalt();
  const kek = await deriveKeyFromPassword(password, salt);
  const rawKey = await exportKey(key);
  const encrypted = await encryptChunk(rawKey, kek);
  const packed = packChunk(encrypted);

  return {
    wrappedKey: encodeBase64Url(packed),
    keySalt: encodeBase64Url(salt),
  };
}

type PendingFile = {
  file: File;
  // フォルダ選択/ドロップ時は "サブフォルダ/ファイル名" のような相対パス
  path: string;
};

// 暗号化済みのチャンク群。ファイル追加と同時にバックグラウンドで暗号化しておき、
// 「アップロードする」が押された時点では暗号化を待たずに送信だけを行えるようにする。
type EncryptedFile = {
  encryptedFileName: string;
  chunks: Uint8Array[];
};

type QueuedFile = {
  pendingFile: PendingFile;
  ready: Promise<EncryptedFile>;
  uploaded: boolean;
};

function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collectEntry(
  entry: FileSystemEntry,
  pending: PendingFile[]
): Promise<void> {
  if (entry.isFile) {
    const file = await readEntryAsFile(entry as FileSystemFileEntry);
    pending.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];

    do {
      batch = await readDirectoryEntries(reader);

      for (const child of batch) {
        await collectEntry(child, pending);
      }
    } while (batch.length > 0);
  }
}

// ドラッグ&ドロップされたフォルダを再帰的に展開し、相対パス付きのファイル一覧にする。
// webkitGetAsEntryが使えない環境ではフラットなファイル一覧にフォールバックする。
async function collectDataTransferFiles(
  dataTransfer: DataTransfer
): Promise<PendingFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);

  if (entries.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({
      file,
      path: file.name,
    }));
  }

  const pending: PendingFile[] = [];

  for (const entry of entries) {
    await collectEntry(entry, pending);
  }

  return pending;
}

export default function UploadForm() {
  const fileInputId = useId();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [retention, setRetention] = useState<Retention>("7d");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dragCounterRef = useRef(0);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileResolveRef = useRef<((token: string) => void) | null>(null);
  const turnstileRejectRef = useRef<((error: Error) => void) | null>(null);

  // 共有全体で1本の鍵を使い回す。ファイル追加時点で(Promiseとして)確定させ、
  // 以降の暗号化・パスワードラップは全てこの同じ鍵を待って使う。
  const keyPromiseRef = useRef<Promise<CryptoKey> | null>(null);
  const queueRef = useRef<QueuedFile[]>([]);
  // クリック(実アップロード)をまたいで同じ共有に相乗りできるよう保持する
  const shareIdRef = useRef<string | undefined>(undefined);
  const uploadTokenRef = useRef<string | undefined>(undefined);

  const getKey = (): Promise<CryptoKey> => {
    if (!keyPromiseRef.current) {
      keyPromiseRef.current = generateKey();
    }
    return keyPromiseRef.current;
  };

  // appearance: "interaction-only" は、Cloudflareが実際にチャレンジ表示が
  // 必要と判断した場合のみウィジェットを表示する(正規ユーザーには通常何も見えない)。
  const ensureTurnstileWidget = (): string | null => {
    if (!window.turnstile || !turnstileContainerRef.current) {
      return null;
    }

    if (turnstileWidgetIdRef.current) {
      return turnstileWidgetIdRef.current;
    }

    const widgetId = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      execution: "execute",
      callback: (token) => {
        const resolve = turnstileResolveRef.current;
        turnstileResolveRef.current = null;
        turnstileRejectRef.current = null;
        resolve?.(token);
      },
      "error-callback": (errorCode) => {
        const reject = turnstileRejectRef.current;
        turnstileResolveRef.current = null;
        turnstileRejectRef.current = null;
        reject?.(
          new Error(`Bot対策の検証に失敗しました(${errorCode})。`)
        );
      },
      "expired-callback": () => {
        const reject = turnstileRejectRef.current;
        turnstileResolveRef.current = null;
        turnstileRejectRef.current = null;
        reject?.(
          new Error(
            "Bot対策の検証がタイムアウトしました。もう一度お試しください。"
          )
        );
      },
    });

    turnstileWidgetIdRef.current = widgetId;
    return widgetId;
  };

  const getTurnstileToken = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!TURNSTILE_SITE_KEY) {
        reject(new Error("Bot対策が設定されていません。"));
        return;
      }

      const widgetId = ensureTurnstileWidget();

      if (!widgetId || !window.turnstile) {
        reject(
          new Error(
            "Bot対策の読み込みに失敗しました。ページを再読み込みしてください。"
          )
        );
        return;
      }

      turnstileResolveRef.current = resolve;
      turnstileRejectRef.current = reject;
      window.turnstile.execute(widgetId);
    });
  };

  // ファイルが追加された瞬間に暗号化だけを始める(ネットワーク送信はまだしない)。
  // 保存期間・パスワードの入力を待つ間の待ち時間を暗号化で埋めるのが狙い。
  const startEncrypting = (
    pendingFile: PendingFile
  ): Promise<EncryptedFile> => {
    return (async () => {
      const key = await getKey();
      const encryptedFileName = await encryptFileName(
        pendingFile.path,
        key
      );
      const chunks: Uint8Array[] = [];

      for await (const chunk of iterateEncryptedChunks(
        pendingFile.file,
        key
      )) {
        chunks.push(chunk);
      }

      return { encryptedFileName, chunks };
    })();
  };

  const addFiles = (newFiles: PendingFile[]) => {
    if (shareUrl) {
      return;
    }

    const oversizedFile = newFiles.find(
      (pendingFile) => pendingFile.file.size > MAX_FILE_SIZE_BYTES
    );

    if (oversizedFile) {
      setError(
        `${oversizedFile.path} はサイズが大きすぎます(1ファイル${formatBytes(
          MAX_FILE_SIZE_BYTES
        )}まで)。`
      );
      return;
    }

    setFiles((prev) => [...prev, ...newFiles]);

    for (const pendingFile of newFiles) {
      const ready = startEncrypting(pendingFile);
      // ここでの例外は実際のアップロード時(upload内でのawait)に処理するので、
      // unhandled rejectionの警告だけを避ける。
      ready.catch(() => {});
      queueRef.current.push({ pendingFile, ready, uploaded: false });
    }
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!event.target.files) {
      return;
    }

    addFiles(
      Array.from(event.target.files).map((file) => ({
        file,
        path: file.name,
      }))
    );
    event.target.value = "";
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current--;

    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    collectDataTransferFiles(event.dataTransfer)
      .then(addFiles)
      .catch(() => setError("ファイルの読み込みに失敗しました。"));
  };

  const upload = async () => {
    if (shareUrl || isUploading) {
      return;
    }

    const pending = queueRef.current.filter((item) => !item.uploaded);

    if (pending.length === 0) {
      setError("ファイルを選択してください。");
      return;
    }

    if (usePassword && !password.trim()) {
      setError("パスワードを入力してください。");
      return;
    }

    setError("");
    setIsUploading(true);
    setProgress(0);
    setShowAdvanced(false);

    try {
      const key = await getKey();
      const isNewShare = !shareIdRef.current;

      const turnstileToken = isNewShare ? await getTurnstileToken() : undefined;
      const passwordWrap =
        isNewShare && usePassword
          ? await wrapKeyWithPassword(key, password)
          : null;

      const totalChunks = pending.reduce(
        (sum, item) =>
          sum + Math.ceil(item.pendingFile.file.size / CHUNK_SIZE),
        0
      );
      let completedChunks = 0;

      for (const item of pending) {
        const { path } = item.pendingFile;
        // 通常はここで既に暗号化が終わっている(クリック前から進めていたため)
        const { encryptedFileName, chunks } = await item.ready;

        const startResponse = await fetch("/api/upload/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            encryptedFileName,
            fileSize: item.pendingFile.file.size,
            shareId: shareIdRef.current,
            uploadToken: uploadTokenRef.current,
            retention,
            wrappedKey: passwordWrap?.wrappedKey,
            keySalt: passwordWrap?.keySalt,
            turnstileToken,
          }),
        });

        const startResult =
          (await startResponse.json()) as UploadStartResponse;

        if (!startResponse.ok || !startResult.uploadSessionId) {
          throw new Error(
            startResult.error ?? `${path} の開始に失敗しました`
          );
        }

        shareIdRef.current = startResult.shareId;
        uploadTokenRef.current = startResult.uploadToken;

        await uploadChunksConcurrently(
          chunks,
          startResult.uploadSessionId,
          path,
          () => {
            completedChunks++;
            setProgress(
              totalChunks > 0
                ? Math.round((completedChunks / totalChunks) * 100)
                : 100
            );
          }
        );

        const completeResponse = await fetch("/api/upload/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uploadSessionId: startResult.uploadSessionId,
          }),
        });

        const completeResult =
          (await completeResponse.json()) as UploadCompleteResponse;

        if (!completeResponse.ok || !completeResult.success) {
          throw new Error(
            completeResult.error ?? `${path} の完了処理に失敗しました`
          );
        }

        item.uploaded = true;
      }

      if (passwordWrap) {
        // パスワード保護時は生の鍵をURLに含めない(パスワードなしでは復号不可能にするため)。
        setShareUrl(`${window.location.origin}/d/${shareIdRef.current}`);
      } else {
        const keyFragment = encodeBase64Url(await exportKey(key));

        setShareUrl(
          `${window.location.origin}/d/${shareIdRef.current}#${keyFragment}`
        );
      }
    } catch (unknownErr) {
      const error =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("Unknown error");

      setError(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 1500);
    }
  };

  const resetForm = () => {
    setFiles([]);
    setShareUrl("");
    setError("");
    setProgress(0);
    setCopyState("idle");
    setUsePassword(false);
    setPassword("");
    setRetention("7d");
    setShowAdvanced(false);

    keyPromiseRef.current = null;
    queueRef.current = [];
    shareIdRef.current = undefined;
    uploadTokenRef.current = undefined;
  };

  const shareToX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      SHARE_MESSAGE
    )}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareToLine = () => {
    const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
      shareUrl
    )}&text=${encodeURIComponent(SHARE_MESSAGE)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareToInstagram = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // クリップボードに失敗しても Instagram は開く
    }
    window.open(
      "https://www.instagram.com/",
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div
      className="relative flex min-h-screen flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-paper/90 backdrop-blur-xs">
          <DropMark className="h-10 w-10 text-brand" />
          <p className="text-lg font-black">ここにドロップ</p>
        </div>
      )}

      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              Anzdrop
            </h1>
            <p className="text-xs text-ink/50">
              ナウでヤングな暗号化ファイル共有サービス
            </p>
          </div>

          <div className="border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            どんなファイルも簡単に共有できます。<br/>プライバシーにこだわっており、いい感じに暗号化されます。
          </div>

          <div className="space-y-5">
            {shareUrl ? (
              <div className="anz-scroll relative flex h-40 flex-col items-center justify-center gap-3 overflow-y-auto rounded border-2 border-brand p-6 text-center anz-drop-enter">
                <button
                  onClick={resetForm}
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
                  <button
                    onClick={shareToX}
                    aria-label="Xで共有"
                    title="Xで共有"
                    className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={shareToInstagram}
                    aria-label="Instagramで共有"
                    title="Instagramで共有"
                    className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                  >
                    <InstagramIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={shareToLine}
                    aria-label="LINEで共有"
                    title="LINEで共有"
                    className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                  >
                    <LineIcon className="h-4 w-4" />
                  </button>
                </div>

                <button
                  onClick={handleCopy}
                  className="rounded bg-ink px-3 py-1 text-xs font-bold text-paper transition-colors hover:bg-ink/90"
                >
                  {copyState === "copied"
                    ? "コピーしました"
                    : copyState === "failed"
                      ? "コピーできませんでした"
                      : "URLをコピー"}
                </button>
              </div>
            ) : isUploading ? (
              <div className="flex h-40 flex-col items-center justify-center gap-3 rounded border-2 border-ink p-6 text-center">
                <Spinner className="h-6 w-6 text-brand" />
                <span className="text-xs font-bold text-ink/50">
                  アップロード中... {progress}%
                </span>
                <div className="h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-ink/10">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : error ? (
              <div className="relative flex h-40 flex-col items-center justify-center gap-2 rounded border-2 border-brand p-6 text-center">
                <button
                  onClick={() => setError("")}
                  aria-label="閉じる"
                  title="閉じる"
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
                <p className="text-sm font-bold text-brand">{error}</p>
              </div>
            ) : (
              <label
                htmlFor={fileInputId}
                className={
                  files.length === 0
                    ? "flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center transition-colors hover:bg-ink/[0.03]"
                    : "anz-scroll block h-40 cursor-pointer overflow-y-auto rounded border-2 border-ink p-2 transition-colors hover:bg-ink/[0.03]"
                }
              >
                {files.length === 0 ? (
                  <>
                    <span className="text-base font-black">
                      ファイルを選択
                    </span>
                    <span className="text-xs font-bold text-ink/50">
                      クリックまたはドラッグ&ドロップで選択<br />フォルダはドラッグでアップロード
                    </span>
                  </>
                ) : (
                  <ul className="divide-y divide-ink/10 text-[13px]">
                    {files.map((pendingFile) => (
                      <li
                        key={`${pendingFile.path}-${pendingFile.file.lastModified}`}
                        className="flex items-center justify-between gap-4 px-2 py-2"
                      >
                        <span className="truncate">{pendingFile.path}</span>
                        <span className="shrink-0 font-bold text-ink/40">
                          {formatBytes(pendingFile.file.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  id={fileInputId}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            )}

            <div
              className={
                !shareUrl && !isUploading ? "" : "invisible"
              }
              inert={!(!shareUrl && !isUploading)}
            >
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="flex items-center gap-1 text-xs font-bold text-ink/50 hover:text-ink"
              >
                詳細設定
                <ChevronIcon
                  className={`h-3 w-3 transition-transform duration-300 ${
                    showAdvanced ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden" inert={!showAdvanced}>
                  <div className="mt-3 space-y-3">
                    <div>
                      <span className="text-xs font-bold text-ink/50">
                        保存期間
                      </span>
                      <div className="mt-1.5 flex gap-2">
                        {RETENTION_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setRetention(option.value)}
                            className={`flex-1 rounded border-2 py-2 text-xs font-bold transition-colors ${
                              retention === option.value
                                ? "border-brand bg-brand text-paper"
                                : "border-ink/20 text-ink/60 hover:border-ink/40"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-xs font-bold text-ink/50">
                        <input
                          type="checkbox"
                          checked={usePassword}
                          onChange={(event) =>
                            setUsePassword(event.target.checked)
                          }
                          className="h-4 w-4 accent-brand"
                        />
                        パスワードを設定する
                      </label>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                          usePassword ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div
                          className="overflow-hidden"
                          inert={!usePassword}
                        >
                          <input
                            type="password"
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                            placeholder="パスワード"
                            className="mt-1.5 w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div ref={turnstileContainerRef} className="flex justify-center" />

            <button
              onClick={upload}
              disabled={isUploading || !!shareUrl}
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {isUploading && <Spinner className="h-4 w-4 text-paper" />}
              {isUploading ? "アップロード中..." : "アップロードする"}
            </button>
          </div>
        </div>
      </main>

      <SiteFooter />

      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </div>
  );
}
