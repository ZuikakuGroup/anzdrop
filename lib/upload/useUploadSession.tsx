"use client";

import { useEffect, useRef, useState } from "react";
import {
  PLAN_DEFAULT_RETENTION,
  getMaxFileSizeBytes,
  getUploadConcurrencyForPlan,
  isTurnstileRequiredForPlan,
  type Plan,
} from "@/lib/plan";
import type { Retention } from "@/lib/retention";
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
import { useUploadSharing } from "./useUploadSharing";
import { useFileDrop } from "./useFileDrop";
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
  preparedEncryptedChunks?: PrefetchedAsyncIterator<Uint8Array> & { abort: AbortController };
  // /api/upload/complete まで到達したか。失敗後のリトライで再処理しないための印。
  completed: boolean;
};

export function useUploadSession() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const uploading = useRef(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [retention, setRetention] = useState<Retention>(PLAN_DEFAULT_RETENTION.free);
  const retentionLockedRef = useRef(false);
  const [usePassword, setUsePassword] = useState(false);
  const [hasCreatedShare, setHasCreatedShare] = useState(false);
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<Plan>("free");
  const [shouldLoadTurnstile, setShouldLoadTurnstile] = useState(false);
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile(shouldLoadTurnstile);

  // 要件書10.1章。トップページ(=アップロード画面)への訪問を1回だけ計測する。
  useEffect(() => {
    // pagehide時の即時送信も登録するため、ここでは遅延させない。短時間で
    // 離脱した訪問を取りこぼすより、軽量な初期化を優先する。
    track("landing_view");
  }, []);

  // 未ログインなら常にfree(既存の匿名アップロードの挙動を維持)。ログイン
  // していれば有料プランの上限緩和・保存期間延長を反映する。
  useEffect(() => {
    let cancelled = false;
    getCurrentAccount()
      .then((data) => {
        if (!cancelled && data.success) {
          setPlan(data.plan);
          // 手動選択・アップロード開始後の保存期間は遅い認証応答で上書きしない。
          if (!retentionLockedRef.current) {
            setRetention(PLAN_DEFAULT_RETENTION[data.plan]);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  const sharing = useUploadSharing(shareUrl, analyticsTransferIdRef);

  const getKey = (): Promise<CryptoKey> => {
    if (!keyPromiseRef.current) {
      keyPromiseRef.current = loadCryptoModule().then(({ generateKey }) =>
        generateKey()
      );
    }
    return keyPromiseRef.current;
  };

  const createRawEncryptedChunkStream = (
    pendingFile: PendingFile,
    signal: AbortSignal
  ): AsyncGenerator<Uint8Array> => {
    async function* encryptedChunks(): AsyncGenerator<Uint8Array> {
      const [key, { iterateEncryptedChunks }] = await Promise.all([
        getKey(),
        loadCryptoModule(),
      ]);
      if (signal.aborted) throw signal.reason;
      yield* iterateEncryptedChunks(pendingFile.file, key, signal);
    }

    return encryptedChunks();
  };

  // ファイル本体は8MiBずつ暗号化する。選択時に先頭チャンクを準備した場合は
  // 同じgeneratorから続きを流し、リトライ時は新しいgeneratorを使う(issue #58)。
  const createEncryptedChunkStream = (
    pendingFile: PendingFile,
    prepared: QueuedFile["preparedEncryptedChunks"],
    signal: AbortSignal
  ): AsyncGenerator<Uint8Array> => {
    const chunks = prepared
      ? continuePrefetched(prepared)
      : createRawEncryptedChunkStream(pendingFile, signal);

    async function* bufferedEncryptedChunks(): AsyncGenerator<Uint8Array> {
      const abortPrepared = () => prepared?.abort.abort(signal.reason);
      signal.addEventListener("abort", abortPrepared, { once: true });
      if (signal.aborted) abortPrepared();
      try {
        const [{ bufferAhead }] = await loadUploadModules();
        yield* bufferAhead(chunks, ENCRYPT_PREFETCH_CHUNKS, signal);
      } finally {
        signal.removeEventListener("abort", abortPrepared);
      }
    }

    return bufferedEncryptedChunks();
  };

  const prepareFirstEncryptedChunk = (item: QueuedFile) => {
    if (item.preparedEncryptedChunks) {
      return;
    }

    const abort = new AbortController();
    const prepared = {
      ...prefetchFirst(createRawEncryptedChunkStream(item.pendingFile, abort.signal)),
      abort,
    };
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
    sharing.reset();
    setError("");
    setProgress(0);
  };

  const addFiles = (newFiles: PendingFile[]) => {
    // アップロード中だけ拒否する。共有結果表示中の DnD 追加は同じ共有へ相乗りさせる。
    if (uploading.current || newFiles.length === 0) {
      return;
    }

    // The API only accepts positive file sizes. Reject the whole selection
    // before queueing, so a mixed batch cannot upload only its non-empty prefix.
    const emptyFile = newFiles.find((pendingFile) => pendingFile.file.size === 0);
    if (emptyFile) {
      setError(`${emptyFile.path} は空のファイルのため送信できません。`);
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

  const prepareTurnstile = () => {
    if (TURNSTILE_SITE_KEY && isTurnstileRequiredForPlan(plan)) {
      setShouldLoadTurnstile(true);
    }
  };

  const upload = async () => {
    if (uploading.current) {
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
    uploading.current = true;
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
            createChunkStream: (signal) => {
              const prepared = item.preparedEncryptedChunks;
              item.preparedEncryptedChunks = undefined;
              return createEncryptedChunkStream(item.pendingFile, prepared, signal);
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
      uploading.current = false;
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFiles([]);
    setShareUrl("");
    setError("");
    setProgress(0);
    sharing.reset();
    setUsePassword(false);
    setHasCreatedShare(false);
    setPassword("");
    retentionLockedRef.current = false;
    setRetention(PLAN_DEFAULT_RETENTION[plan]);
    setShowAdvanced(false);

    keyPromiseRef.current = null;
    queueRef.current = [];
    shareIdRef.current = undefined;
    uploadTokenRef.current = undefined;
    analyticsTransferIdRef.current = undefined;
    passwordProtectedRef.current = false;
  };

  const drop = useFileDrop(addFiles, setError);

  return {
    files, shareUrl, isUploading, error, setError, progress,
    retention, setRetention: (value: Retention) => {
      retentionLockedRef.current = true;
      setRetention(value);
    },
    usePassword, setUsePassword, password, setPassword, hasCreatedShare,
    showAdvanced, setShowAdvanced, plan, shouldLoadTurnstile, turnstileWidget,
    handleFileChange, prepareTurnstile, upload, resetForm, ...sharing,
    ...drop,
  };
}
