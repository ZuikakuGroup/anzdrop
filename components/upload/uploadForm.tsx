"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Script from "next/script";
import {
  getMaxFileSizeBytes,
  getUploadConcurrencyForPlan,
  isTurnstileRequiredForPlan,
  type Plan,
} from "@/lib/plan";
import type { Retention } from "@/lib/retention";
import DropMark from "@/components/brand/DropMark";
import Spinner from "@/components/brand/Spinner";
import {
  XIcon,
  LineIcon,
  QrCodeIcon,
  ShareIcon,
} from "@/components/brand/ShareIcons";
import { formatBytes } from "@/lib/format";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import { track } from "@/lib/analytics/client";
import { getSizeBucket } from "@/lib/analytics/sizeBucket";
import { classifyUploadError } from "@/lib/analytics/errorCodes";
import type { PendingFile } from "@/lib/upload/dragDropFiles";
import {
  checkSharePasswordBeforeUpload,
} from "@/lib/passwordPolicy";
import { getCurrentAccount } from "@/lib/account/me-client";

// 共有リンクの発行後、利用者がQRボタンを押すときだけ必要になる。初回表示で
// qrcodeライブラリをダウンロード・評価しないようクライアント側で遅延読込する。
const QrCodeModal = dynamic(() => import("@/components/brand/QrCodeModal"), {
  ssr: false,
});

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
// この先読みは「アップロードする」を押したあと、実際に処理中のファイル1つ分に
// ついてのみ走る(GitHub issue #60)。
const ENCRYPT_PREFETCH_CHUNKS = 8;

type QueuedFile = {
  pendingFile: PendingFile;
  // ファイル名の暗号化は小さく即座に終わるので、ファイル追加時点で開始しておく。
  encryptedFileName: Promise<string>;
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
  const [retention, setRetention] = useState<Retention>("7d");
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

  // ファイル本体を暗号化しながら先読みバッファ付きで流すストリームを作る。
  // ファイル追加時ではなく、upload() が実際にそのファイルを処理する直前に
  // 呼ぶ。こうすることで、同時に選択したファイル数によらず、先読みバッファ
  // (ENCRYPT_PREFETCH_CHUNKS = 64MiB)が走るのは常に1ファイル分だけになる
  // (数十〜数百ファイルのフォルダを追加してもメモリが 64MiB×N にならない。
  // GitHub issue #60)。
  //
  // 失敗後のリトライでは毎回この関数で作り直す。途中まで消費したストリームを
  // 再利用すると、2回目のマルチパートセッションへファイルの途中からのバイト
  // だけが送られ、サイズ検証を通り抜けてサイレントに破損する(GitHub issue #58)。
  const createEncryptedChunkStream = (
    pendingFile: PendingFile
  ): AsyncGenerator<Uint8Array> => {
    async function* encryptedChunks(): AsyncGenerator<Uint8Array> {
      const [key, { iterateEncryptedChunks }] = await Promise.all([
        getKey(),
        loadCryptoModule(),
      ]);
      yield* iterateEncryptedChunks(pendingFile.file, key);
    }

    async function* bufferedEncryptedChunks(): AsyncGenerator<Uint8Array> {
      const [{ bufferAhead }] = await loadUploadModules();
      yield* bufferAhead(encryptedChunks(), ENCRYPT_PREFETCH_CHUNKS);
    }

    return bufferedEncryptedChunks();
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

    track("file_select", {
      properties: {
        fileCount: newFiles.length,
        totalSizeBucket: getSizeBucket(
          newFiles.reduce((sum, pendingFile) => sum + pendingFile.file.size, 0)
        ),
      },
    });

    for (const pendingFile of newFiles) {
      // ファイル名の暗号化(単一チャンク・数十バイト)だけは先に始めておく。
      // ファイル本体の暗号化は upload() が処理する直前まで始めない(issue #60)。
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
    if (shareUrl || isUploading) {
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

    setError("");
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
            // ファイル本体の暗号化ストリームは、このファイルを処理する直前に
            // 作る。失敗後のリトライでこのループに再入した場合も毎回作り直す
            // (途中まで消費したストリームを再利用しない。issue #58 / #60)。
            createChunkStream: () =>
              createEncryptedChunkStream(item.pendingFile),
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
    setRetention("7d");
    setShowAdvanced(false);

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
      {isDragging && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-paper/90 backdrop-blur-xs">
          <DropMark className="h-14 w-14 text-brand" />
          <p className="text-lg font-black">ここにドロップ</p>
        </div>
      )}

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
                  {canShareNatively && (
                    <button
                      onClick={shareNative}
                      aria-label="共有"
                      title="共有"
                      className="flex h-9 w-9 items-center justify-center rounded border border-ink text-ink transition-colors hover:bg-ink/[0.03]"
                    >
                      <ShareIcon className="h-4 w-4" />
                    </button>
                  )}
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
                <span aria-hidden="true">{showAdvanced ? "⌃" : "⌄"}</span>
              </button>

              <div
                id="upload-advanced-settings"
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden" inert={!showAdvanced}>
                  {showAdvanced && AdvancedSettings && (
                    <AdvancedSettings
                      plan={plan}
                      retention={retention}
                      onRetentionChange={setRetention}
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
