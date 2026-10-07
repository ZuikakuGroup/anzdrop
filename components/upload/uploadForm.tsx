"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Script from "@/components/brand/ExternalScript";
import {
  PLAN_DEFAULT_RETENTION,
  getMaxFileSizeBytes,
  getUploadConcurrencyForPlan,
  isTurnstileRequiredForPlan,
  type Plan,
} from "@/lib/plan";
import type { Retention } from "@/lib/retention";
import Spinner from "@/components/brand/Spinner";
import { ChevronIcon } from "@/components/brand/ShareIcons";
import { formatBytes } from "@/lib/format";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import { track } from "@/lib/analytics/client";
import { getSizeBucket } from "@/lib/analytics/sizeBucket";
import { classifyUploadError } from "@/lib/analytics/errorCodes";
import type { PendingFile } from "@/lib/upload/dragDropFiles";
import { shouldDismissShareResultForAdditionalUpload } from "@/lib/upload/shareResultSession";
import {
  checkSharePasswordBeforeUpload,
} from "@/lib/passwordPolicy";
import { getCurrentAccount } from "@/lib/account/me-client";
import {
  continuePrefetched,
  prefetchFirst,
  type PrefetchedAsyncIterator,
} from "@/lib/upload/prefetchedAsyncIterator";
import UploadDropOverlay from "@/components/upload/UploadDropOverlay";
import UploadShareResult from "@/components/upload/UploadShareResult";
import UploadProgress from "@/components/upload/UploadProgress";
import UploadErrorPanel from "@/components/upload/UploadErrorPanel";
import UploadFilePicker from "@/components/upload/UploadFilePicker";

type AdvancedSettingsModule = typeof import("@/components/upload/AdvancedSettings");

let advancedSettingsPromise: Promise<AdvancedSettingsModule> | undefined;

function loadAdvancedSettings() {
  if (!advancedSettingsPromise) {
    const pendingImport = import("@/components/upload/AdvancedSettings");
    advancedSettingsPromise = pendingImport;
    void pendingImport.catch(() => {
      if (advancedSettingsPromise === pendingImport) {
        advancedSettingsPromise = undefined;
      }
    });
  }
  return advancedSettingsPromise;
}

function preloadAdvancedSettings() {
  void loadAdvancedSettings().catch(() => {});
}

let cryptoModulePromise: Promise<typeof import("@/lib/crypto")> | undefined;
let uploadModulesPromise:
  | Promise<[
      typeof import("@/lib/asyncBuffer"),
      typeof import("@/lib/upload/encrypt"),
      typeof import("@/lib/upload/uploadFile"),
    ]>
  | undefined;

function loadCryptoModule(): Promise<typeof import("@/lib/crypto")> {
  cryptoModulePromise ??= import("@/lib/crypto");
  return cryptoModulePromise;
}

function loadUploadModules(): NonNullable<typeof uploadModulesPromise> {
  uploadModulesPromise ??= Promise.all([
    import("@/lib/asyncBuffer"),
    import("@/lib/upload/encrypt"),
    import("@/lib/upload/uploadFile"),
  ]);
  return uploadModulesPromise;
}

const SHARE_MESSAGE = "Anzdropで暗号化ファイルを共有しました";

// アップロード中、暗号化1チャンクあたり最大この件数まで、送信側の消費を待たずに
// 先読みしておく(8チャンク = 64MiB上限)。ファイル全体を暗号化してからアップロード
// を始めるのではなく、暗号化とアップロードを重ねて進めるためのバッファ上限。
// 選択時の先行暗号化はキュー先頭の1チャンク(8MiB)に制限する。
const ENCRYPT_PREFETCH_CHUNKS = 8;

type QueuedFile = {
  pendingFile: PendingFile;
  // ファイル名の暗号化は小さく即座に終わるので、ファイル追加時点で開始しておく。
  encryptedFileName: Promise<string>;
  // キュー先頭だけ、選択後に本体の先頭チャンクを暗号化しておく。
  preparedEncryptedChunks?: PrefetchedAsyncIterator<Uint8Array>;
  // /api/upload/complete まで到達したか。失敗後のリトライで再処理しないための印。
  completed: boolean;
};

type UploadFormProps = {
  header: ReactNode;
  footer: ReactNode;
};

export default function UploadForm({ header, footer }: UploadFormProps) {
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
  const [retention, setRetention] = useState<Retention>(PLAN_DEFAULT_RETENTION.free);
  const retentionLockedRef = useRef(false);
  const [usePassword, setUsePassword] = useState(false);
  const [hasCreatedShare, setHasCreatedShare] = useState(false);
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [AdvancedSettings, setAdvancedSettings] = useState<
    AdvancedSettingsModule["default"] | null
  >(null);
  const [plan, setPlan] = useState<Plan>("free");
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [canShareNatively, setCanShareNatively] = useState(false);
  const dragCounterRef = useRef(0);
  const [shouldLoadTurnstile, setShouldLoadTurnstile] = useState(false);
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile(shouldLoadTurnstile);

  // 要件書10.1章。トップページ(=アップロード画面)への訪問を1回だけ計測する。
  useEffect(() => {
    // pagehide時の即時送信も登録するため、ここでは遅延させない。短時間で
    // 離脱した訪問を取りこぼすより、軽量な初期化を優先する。
    track("landing_view");
  }, []);

  // navigator.shareの有無はサーバー側では判定できないため、マウント後に
  // クライアントで判定する(SSRとのハイドレーション不一致を避ける)。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 購読すべき外部イベントの無い、マウント時一度きりのブラウザ機能検出
    setCanShareNatively(typeof navigator.share === "function");
  }, []);

  // 未ログインなら常にfree(既存の匿名アップロードの挙動を維持)。ログイン
  // していれば有料プランの上限緩和・保存期間延長を反映する。
  useEffect(() => {
    getCurrentAccount()
      .then((data) => {
        if (data.success) {
          setPlan(data.plan);
          // 手動選択・アップロード開始後の保存期間は遅い認証応答で上書きしない。
          if (!retentionLockedRef.current) {
            setRetention(PLAN_DEFAULT_RETENTION[data.plan]);
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showAdvanced || AdvancedSettings) {
      return;
    }

    let cancelled = false;
    loadAdvancedSettings()
      .then((module) => {
        if (!cancelled) {
          setAdvancedSettings(() => module.default);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [showAdvanced, AdvancedSettings]);

  const maxFileSizeBytes = getMaxFileSizeBytes(plan);

  // 共有全体で1本の鍵を使い回す。ファイル追加時点で(Promiseとして)確定させ、
  // 以降の暗号化・パスワードラップは全てこの同じ鍵を待って使う。
  const keyPromiseRef = useRef<Promise<CryptoKey> | null>(null);
  const queueRef = useRef<QueuedFile[]>([]);
  // クリック(実アップロード)をまたいで同じ共有に相乗りできるよう保持する
  const shareIdRef = useRef<string | undefined>(undefined);
  const uploadTokenRef = useRef<string | undefined>(undefined);
  // 共有リンクのコピー/ネイティブ共有イベントに添えるための、直近のtransfer相関ID。
  const analyticsTransferIdRef = useRef<string | undefined>(undefined);
  // この共有がパスワード保護付きで作成されたか。作成後に詳細設定を変えて
  // リトライしても、鍵の受け渡し方法(URLフラグメント or パスワード)が
  // 共有の実態とズレないよう、作成時点の事実として1度だけ記録する。
  const passwordProtectedRef = useRef(false);

  const getKey = (): Promise<CryptoKey> => {
    if (!keyPromiseRef.current) {
      keyPromiseRef.current = loadCryptoModule().then(({ generateKey }) =>
        generateKey()
      );
    }
    return keyPromiseRef.current;
  };

  const createRawEncryptedChunkStream = (
    pendingFile: PendingFile
  ): AsyncGenerator<Uint8Array> => {
    async function* encryptedChunks(): AsyncGenerator<Uint8Array> {
      const [key, { iterateEncryptedChunks }] = await Promise.all([
        getKey(),
        loadCryptoModule(),
      ]);
      yield* iterateEncryptedChunks(pendingFile.file, key);
    }

    return encryptedChunks();
  };

  // ファイル本体は8MiBずつ暗号化する。選択時に先頭チャンクを準備した場合は
  // 同じgeneratorから続きを流し、リトライ時は新しいgeneratorを使う(issue #58)。
  const createEncryptedChunkStream = (
    pendingFile: PendingFile,
    prepared?: PrefetchedAsyncIterator<Uint8Array>
  ): AsyncGenerator<Uint8Array> => {
    const chunks = prepared
      ? continuePrefetched(prepared)
      : createRawEncryptedChunkStream(pendingFile);

    async function* bufferedEncryptedChunks(): AsyncGenerator<Uint8Array> {
      const [{ bufferAhead }] = await loadUploadModules();
      yield* bufferAhead(chunks, ENCRYPT_PREFETCH_CHUNKS);
    }

    return bufferedEncryptedChunks();
  };

  const prepareFirstEncryptedChunk = (item: QueuedFile) => {
    if (item.preparedEncryptedChunks) {
      return;
    }

    const prepared = prefetchFirst(
      createRawEncryptedChunkStream(item.pendingFile)
    );
    item.preparedEncryptedChunks = prepared;
    void prepared.firstResult.catch(() => {
      if (item.preparedEncryptedChunks === prepared) {
        item.preparedEncryptedChunks = undefined;
      }
    });
  };

  // 共有結果パネルを閉じても、同じ共有への相乗りのため shareId / uploadToken /
  // 鍵 / hasCreatedShare は残す(resetForm とは違う)。
  const dismissShareResultKeepSession = () => {
    setShareUrl("");
    setCopyState("idle");
    setError("");
    setProgress(0);
    setIsQrOpen(false);
  };

  const addFiles = (newFiles: PendingFile[]) => {
    // アップロード中だけ拒否する。共有結果表示中の DnD 追加は同じ共有へ相乗りさせる。
    if (isUploading || newFiles.length === 0) {
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

    // 追加できるファイルが確定してから結果パネルを閉じる(失敗 DnD で鍵付き URL を消さない)。
    if (
      shouldDismissShareResultForAdditionalUpload({
        shareUrl,
        isUploading,
        acceptedFileCount: newFiles.length,
      })
    ) {
      dismissShareResultKeepSession();
      setFiles(newFiles);
    } else {
      setFiles((prev) => [...prev, ...newFiles]);
    }

    track("file_select", {
      properties: {
        fileCount: newFiles.length,
        totalSizeBucket: getSizeBucket(
          newFiles.reduce((sum, pendingFile) => sum + pendingFile.file.size, 0)
        ),
      },
    });

    const hasPendingFile = queueRef.current.some((item) => !item.completed);

    for (const pendingFile of newFiles) {
      // ファイル名の暗号化(単一チャンク・数十バイト)は先に開始しておく。
      const encryptedFileName = Promise.all([getKey(), loadUploadModules()]).then(
        ([key, [, { encryptFileName }]]) =>
          encryptFileName(pendingFile.path, key)
      );
      // ここでの例外は実際のアップロード時(upload内でのawait)に処理するので、
      // unhandled rejectionの警告だけを避ける。
      encryptedFileName.catch(() => {});
      queueRef.current.push({
        pendingFile,
        encryptedFileName,
        completed: false,
      });
    }

    // 選択後すぐにキュー先頭の最初の暗号化チャンクだけを準備する。
    // 全選択ファイルを先行暗号化すると、選択数に応じてメモリが増えるため行わない。
    if (!isUploading && !hasPendingFile) {
      const firstPending = queueRef.current.find((item) => !item.completed);
      if (firstPending) {
        prepareFirstEncryptedChunk(firstPending);
      }
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

  const prepareTurnstile = () => {
    if (TURNSTILE_SITE_KEY && isTurnstileRequiredForPlan(plan)) {
      setShouldLoadTurnstile(true);
    }
  };

  const upload = async () => {
    if (isUploading) {
      return;
    }

    const pending = queueRef.current.filter((item) => !item.completed);

    if (pending.length === 0) {
      setError("ファイルを選択してください。");
      return;
    }

    // 検証の条件と理由は lib/passwordPolicy.ts の
    // checkSharePasswordBeforeUpload を参照(共有作成後の再試行では検証しない)。
    const passwordCheck = checkSharePasswordBeforeUpload({
      isNewShare: !shareIdRef.current,
      usePassword,
      password,
    });

    if (!passwordCheck.ok) {
      setError(passwordCheck.error);
      return;
    }

    // 選択時の先行準備が失敗した場合や、送信後のリトライではここで改めて準備する。
    const firstPending = pending[0];
    if (firstPending) {
      prepareFirstEncryptedChunk(firstPending);
    }

    setError("");
    retentionLockedRef.current = true;
    setIsUploading(true);
    setProgress(0);
    setShowAdvanced(false);

    try {
      const [key, cryptoModule, [, uploadEncrypt, uploadFile]] = await Promise.all([
        getKey(),
        loadCryptoModule(),
        loadUploadModules(),
      ]);
      const isNewShare = !shareIdRef.current;

      const turnstileToken =
        isNewShare && isTurnstileRequiredForPlan(plan)
          ? (prepareTurnstile(), await getTurnstileToken())
          : undefined;
      const passwordWrap =
        isNewShare && usePassword
          ? await uploadEncrypt.wrapKeyWithPassword(key, password)
          : null;

      // 進捗の分母は「実際にネットワークへ送出される暗号化ストリームの
      // 総バイト数」にする。onBytesUploadedに渡ってくるのは各パートの
      // 暗号化後のバイト数なので、平文のfile.sizeを分母にすると暗号化
      // オーバーヘッド(salt + パケットごとのIV/GCMタグ)の分だけ進捗が
      // 先行し、小さいファイルでは完了前に100%に達してしまう。
      const totalBytes = pending.reduce(
        (sum, item) =>
          sum + cryptoModule.getCiphertextSizeFromPlaintextSize(item.pendingFile.file.size),
        0
      );
      let uploadedBytes = 0;

      for (const item of pending) {
        const { path } = item.pendingFile;
        // ファイル名の暗号化はすぐ終わるので待つ。
        const encryptedFileName = await item.encryptedFileName;

        const attemptId = crypto.randomUUID();
        const startedAt = Date.now();
        let analyticsTransferId: string | undefined;

        try {
          const result = await uploadFile.uploadEncryptedFile({
            path,
            encryptedFileName,
            fileSize: item.pendingFile.file.size,
            retention,
            shareId: shareIdRef.current,
            uploadToken: uploadTokenRef.current,
            wrappedKey: passwordWrap?.wrappedKey,
            keySalt: passwordWrap?.keySalt,
            turnstileToken,
            concurrency: getUploadConcurrencyForPlan(plan),
            onBytesUploaded: (bytes) => {
              uploadedBytes += bytes;
              setProgress(
                totalBytes > 0
                  ? Math.min(
                      100,
                      Math.round((uploadedBytes / totalBytes) * 100)
                    )
                  : 100
              );
            },
            onStarted: (info) => {
              analyticsTransferId = info.analyticsTransferId;
              track("upload_start", {
                attemptId,
                analyticsTransferId,
                properties: {
                  fileCount: 1,
                  totalSizeBucket: getSizeBucket(item.pendingFile.file.size),
                },
              });
            },
            // 選択時の先頭チャンクを一度だけ引き継ぐ。以後のリトライでは
            // 消費済みgeneratorを再利用せず、先頭から作り直す(issue #58)。
            createChunkStream: () => {
              const prepared = item.preparedEncryptedChunks;
              item.preparedEncryptedChunks = undefined;
              return createEncryptedChunkStream(item.pendingFile, prepared);
            },
          });

          track("upload_success", {
            attemptId,
            analyticsTransferId: result.analyticsTransferId ?? analyticsTransferId,
            properties: { durationMs: Date.now() - startedAt },
          });

          shareIdRef.current = result.shareId;
          uploadTokenRef.current = result.uploadToken;
          analyticsTransferIdRef.current =
            result.analyticsTransferId ?? analyticsTransferId;
          setHasCreatedShare(true);
          if (isNewShare && passwordWrap) {
            passwordProtectedRef.current = true;
          }

          item.completed = true;
          const nextPending = pending.find((candidate) => !candidate.completed);
          if (nextPending) {
            prepareFirstEncryptedChunk(nextPending);
          }
        } catch (uploadError) {
          track("upload_error", {
            attemptId,
            analyticsTransferId,
            properties: {
              errorCode: classifyUploadError(uploadError),
              errorStage: analyticsTransferId ? "chunk_or_complete" : "start",
              retryCount: 0,
            },
          });

          throw uploadError;
        }
      }

      if (passwordProtectedRef.current) {
        // パスワード保護時は生の鍵をURLに含めない(パスワードなしでは復号不可能にするため)。
        setShareUrl(`${window.location.origin}/d/${shareIdRef.current}`);
      } else {
        const keyFragment = cryptoModule.encodeBase64Url(
          await cryptoModule.exportKey(key)
        );

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
      track("share_link_copy", {
        analyticsTransferId: analyticsTransferIdRef.current,
      });
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
    setHasCreatedShare(false);
    setPassword("");
    retentionLockedRef.current = false;
    setRetention(PLAN_DEFAULT_RETENTION[plan]);
    setShowAdvanced(false);
    setIsQrOpen(false);

    keyPromiseRef.current = null;
    queueRef.current = [];
    shareIdRef.current = undefined;
    uploadTokenRef.current = undefined;
    analyticsTransferIdRef.current = undefined;
    passwordProtectedRef.current = false;
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

  return (
    <div
      className="relative flex min-h-screen flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && <UploadDropOverlay />}

      {header}

      {/* ヘッダー(h-16)とメインだけでちょうど1画面分の高さになるようにして、
          フッターは常にファーストビューの外(スクロールしないと見えない位置)へ
          追い出す。モバイルのブラウザUIバー表示時でも隠れるよう svh を使う。 */}
      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
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
              <UploadShareResult
                shareUrl={shareUrl}
                copyState={copyState}
                canShareNatively={canShareNatively}
                isQrOpen={isQrOpen}
                onReset={resetForm}
                onCopy={handleCopy}
                onShareNative={shareNative}
                onShareToLine={shareToLine}
                onOpenQr={() => setIsQrOpen(true)}
                onCloseQr={() => setIsQrOpen(false)}
              />
            ) : isUploading ? (
              <UploadProgress progress={progress} />
            ) : error ? (
              <UploadErrorPanel error={error} onDismiss={() => setError("")} />
            ) : (
              <UploadFilePicker
                fileInputId={fileInputId}
                files={files}
                onFileChange={handleFileChange}
              />
            )}

            <div
              className={
                !shareUrl && !isUploading ? "" : "invisible"
              }
              inert={!(!shareUrl && !isUploading)}
            >
              <button
                type="button"
                onClick={() => {
                  preloadAdvancedSettings();
                  setShowAdvanced((prev) => !prev);
                }}
                onPointerEnter={preloadAdvancedSettings}
                onFocus={preloadAdvancedSettings}
                aria-expanded={showAdvanced}
                aria-controls="upload-advanced-settings"
                className="flex items-center gap-1 text-xs font-bold text-ink/50 hover:text-ink"
              >
                詳細設定
                <ChevronIcon
                  className={`h-3 w-3 shrink-0 transition-transform duration-300 ${
                    showAdvanced ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                id="upload-advanced-settings"
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden" inert={!showAdvanced}>
                  {AdvancedSettings && (
                    <AdvancedSettings
                      plan={plan}
                      retention={retention}
                      onRetentionChange={(value) => {
                        retentionLockedRef.current = true;
                        setRetention(value);
                      }}
                      usePassword={usePassword}
                      onUsePasswordChange={setUsePassword}
                      password={password}
                      onPasswordChange={setPassword}
                      hasCreatedShare={hasCreatedShare}
                    />
                  )}
                </div>
              </div>
            </div>

            {turnstileWidget}

            <button
              onClick={upload}
              onPointerEnter={prepareTurnstile}
              onPointerDown={prepareTurnstile}
              onFocus={prepareTurnstile}
              disabled={isUploading || !!shareUrl}
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {isUploading && <Spinner className="h-4 w-4 text-paper" />}
              {isUploading ? "アップロード中..." : "アップロードする"}
            </button>
          </div>
        </div>
      </main>

      {footer}

      {shouldLoadTurnstile && TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </div>
  );
}
