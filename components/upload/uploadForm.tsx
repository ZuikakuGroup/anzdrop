"use client";

import { useEffect, useId, useRef, useState } from "react";
import Script from "next/script";
import {
  generateKey,
  exportKey,
  encodeBase64Url,
  iterateEncryptedChunks,
} from "@/lib/crypto";
import { CHUNK_SIZE } from "@/lib/crypto/types";
import { bufferAhead } from "@/lib/asyncBuffer";
import {
  getMaxFileSizeBytes,
  getUploadConcurrencyForPlan,
  isRetentionAllowedForPlan,
  isTurnstileRequiredForPlan,
  type Plan,
} from "@/lib/plan";
import type { Retention } from "@/lib/retention";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import DropMark from "@/components/brand/DropMark";
import Spinner from "@/components/brand/Spinner";
import {
  XIcon,
  LineIcon,
  ChevronIcon,
  QrCodeIcon,
} from "@/components/brand/ShareIcons";
import { formatBytes } from "@/lib/format";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import PasswordInput from "@/components/brand/PasswordInput";
import QrCodeModal from "@/components/brand/QrCodeModal";
import type { MeResponse } from "@/app/api/account/me/schema";
import { uploadChunksFromStream } from "@/lib/upload/chunkUploader";
import {
  type PendingFile,
  collectDataTransferFiles,
} from "@/lib/upload/dragDropFiles";
import { encryptFileName, wrapKeyWithPassword } from "@/lib/upload/encrypt";

const SHARE_MESSAGE = "Anzdropで暗号化ファイルを共有しました";

// "15d"はStandard/Premium限定、"30d"はPremium限定。実際に選択肢として出すか
// どうかはisRetentionAllowedForPlanで絞る。
const RETENTION_OPTIONS: { value: Retention; label: string }[] = [
  { value: "once", label: "1回" },
  { value: "1d", label: "1日" },
  { value: "3d", label: "3日" },
  { value: "7d", label: "7日" },
  { value: "15d", label: "15日" },
  { value: "30d", label: "30日" },
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

// 暗号化1チャンクあたり最大この件数まで、アップロード側の消費を待たずに先読みしておく
// (8チャンク = 64MiB上限)。ファイル全体を暗号化してからアップロードを始めるのではなく、
// 暗号化とアップロードを重ねて進めるためのバッファ上限で、メモリ使用量をここで頭打ちにする。
const ENCRYPT_PREFETCH_CHUNKS = 8;

// ファイル追加と同時にバックグラウンドで暗号化を始めるストリーム。
// chunksは先読みバッファ付きの非同期ジェネレータで、ファイル全体を暗号化し終える
// 前から(バッファが埋まった分だけ)アップロード側が消費を始められる。
type EncryptedFileStream = {
  encryptedFileName: Promise<string>;
  chunks: AsyncGenerator<Uint8Array>;
};

type QueuedFile = {
  pendingFile: PendingFile;
  encrypted: EncryptedFileStream;
  uploaded: boolean;
};

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
  const [plan, setPlan] = useState<Plan>("free");
  const [isQrOpen, setIsQrOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  // 未ログインなら常にfree(既存の匿名アップロードの挙動を維持)。ログイン
  // していれば有料プランの上限緩和・保存期間延長を反映する。
  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (data.success) {
          setPlan(data.plan);
        }
      })
      .catch(() => {});
  }, []);

  const maxFileSizeBytes = getMaxFileSizeBytes(plan);

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

  // ファイルが追加された瞬間に暗号化だけを始める(ネットワーク送信はまだしない)。
  // 保存期間・パスワードの入力を待つ間の待ち時間を暗号化で埋めるのが狙い。
  // chunksはENCRYPT_PREFETCH_CHUNKS件を上限に先読みするだけで、ファイル全体を
  // メモリに保持しない(「アップロードする」を押した時点でアップロード側が
  // 消費を始めれば、そこから先は暗号化とアップロードが並行して進む)。
  const startEncrypting = (pendingFile: PendingFile): EncryptedFileStream => {
    const encryptedFileName = getKey().then((key) =>
      encryptFileName(pendingFile.path, key)
    );

    async function* encryptedChunks(): AsyncGenerator<Uint8Array> {
      const key = await getKey();
      yield* iterateEncryptedChunks(pendingFile.file, key);
    }

    return {
      encryptedFileName,
      chunks: bufferAhead(encryptedChunks(), ENCRYPT_PREFETCH_CHUNKS),
    };
  };

  const addFiles = (newFiles: PendingFile[]) => {
    if (shareUrl) {
      return;
    }

    const oversizedFile = newFiles.find(
      (pendingFile) => pendingFile.file.size > maxFileSizeBytes
    );

    if (oversizedFile) {
      setError(
        `${oversizedFile.path} はサイズが大きすぎます(1ファイル${formatBytes(
          maxFileSizeBytes
        )}まで)。`
      );
      return;
    }

    setFiles((prev) => [...prev, ...newFiles]);

    for (const pendingFile of newFiles) {
      const encrypted = startEncrypting(pendingFile);
      // ここでの例外は実際のアップロード時(upload内でのawait)に処理するので、
      // unhandled rejectionの警告だけを避ける。
      encrypted.encryptedFileName.catch(() => {});
      queueRef.current.push({ pendingFile, encrypted, uploaded: false });
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

      const turnstileToken =
        isNewShare && isTurnstileRequiredForPlan(plan)
          ? await getTurnstileToken()
          : undefined;
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
        // ファイル名の暗号化はすぐ終わるので待つが、本体チャンクの暗号化は
        // 待たない(アップロード中も並行して進み続ける)。
        const encryptedFileName = await item.encrypted.encryptedFileName;

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

        if (
          !startResponse.ok ||
          !startResult.uploadSessionId ||
          !startResult.uploadToken
        ) {
          throw new Error(
            startResult.error ?? `${path} の開始に失敗しました`
          );
        }

        shareIdRef.current = startResult.shareId;
        uploadTokenRef.current = startResult.uploadToken;

        await uploadChunksFromStream(
          item.encrypted.chunks,
          startResult.uploadSessionId,
          startResult.uploadToken,
          path,
          getUploadConcurrencyForPlan(plan),
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
          : new Error("不明なエラー");

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

  const shareToLine = () => {
    const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
      shareUrl
    )}&text=${encodeURIComponent(SHARE_MESSAGE)}`;
    window.open(url, "_blank", "noopener,noreferrer");
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
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
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
                    onClick={shareToLine}
                    aria-label="LINEで共有"
                    title="LINEで共有"
                    className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                  >
                    <LineIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setIsQrOpen(true)}
                    aria-label="QRコードを表示"
                    title="QRコードを表示"
                    className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                  >
                    <QrCodeIcon className="h-4 w-4" />
                  </button>
                </div>

                <QrCodeModal
                  url={shareUrl}
                  isOpen={isQrOpen}
                  onClose={() => setIsQrOpen(false)}
                />

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
                        {RETENTION_OPTIONS.filter((option) =>
                          isRetentionAllowedForPlan(option.value, plan)
                        ).map((option) => (
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
                          <PasswordInput
                            value={password}
                            onChange={setPassword}
                            placeholder="パスワード"
                            autoComplete="new-password"
                            className="mt-1.5 w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand sm:text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {turnstileWidget}

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
