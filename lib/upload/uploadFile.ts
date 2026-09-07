import type { Retention } from "@/lib/retention";
import { uploadChunksFromStream } from "@/lib/upload/chunkUploader";

type UploadStartResponse = {
  success: boolean;
  shareId?: string;
  uploadToken?: string;
  uploadSessionId?: string;
  expiresAt?: string;
  analyticsTransferId?: string;
  error?: string;
};

type UploadCompleteResponse = {
  success: boolean;
  fileId?: string;
  error?: string;
};

export type UploadEncryptedFileParams = {
  // 表示・エラーメッセージ用の元ファイル名(パス)。
  path: string;
  // 暗号化済みファイル名(base64url)。
  encryptedFileName: string;
  // 平文のバイト数(/api/upload/start の事前上限チェック用)。
  fileSize: number;
  retention: Retention;
  // 既存共有への相乗り時に渡す。新規共有なら undefined。
  shareId: string | undefined;
  uploadToken: string | undefined;
  // 新規共有をパスワード保護で作る場合のみ。
  wrappedKey?: string;
  keySalt?: string;
  turnstileToken?: string;
  concurrency: number;
  onBytesUploaded: (bytes: number) => void;
  // /api/upload/start が成功した直後(チャンク送信を始める前)に1回呼ぶ。
  // 計測(upload_start)をチャンク送信の完了を待たずに発火するためのフック。
  onStarted?: (info: { shareId: string; analyticsTransferId?: string }) => void;
  // 暗号化チャンクストリームを「その場で新規に」生成するファクトリ。
  //
  // 呼び出しごとに、必ずファイルの先頭から作り直したストリームを返すこと。
  // 途中まで消費したストリームを渡すと、2 回目のマルチパートセッションへ
  // ファイルの途中からのバイトだけが送られ、サイズ検証を通り抜けたまま
  // サイレントに破損する(GitHub issue #58)。この関数を再試行で呼び直す
  // 場合も、新しいストリームが渡ってくることに依存している。
  createChunkStream: () => AsyncGenerator<Uint8Array>;
};

export type UploadEncryptedFileResult = {
  shareId: string;
  uploadToken: string;
  analyticsTransferId?: string;
};

async function parseJsonOrEmpty<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

// 1 ファイルを「/api/upload/start → チャンク送信 → /api/upload/complete」の
// 順で R2 のマルチパートアップロードへ送り切る。失敗すると Error を throw する
// ため、呼び出し側はこの関数をそのまま再試行できる(start を含めて毎回やり直す
// ことで、部分的に消費された状態を持ち越さない)。
export async function uploadEncryptedFile(
  params: UploadEncryptedFileParams
): Promise<UploadEncryptedFileResult> {
  const startResponse = await fetch("/api/upload/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encryptedFileName: params.encryptedFileName,
      fileSize: params.fileSize,
      shareId: params.shareId,
      uploadToken: params.uploadToken,
      retention: params.retention,
      wrappedKey: params.wrappedKey,
      keySalt: params.keySalt,
      turnstileToken: params.turnstileToken,
    }),
  });

  const startResult = await parseJsonOrEmpty<UploadStartResponse>(startResponse);

  if (
    !startResponse.ok ||
    !startResult.shareId ||
    !startResult.uploadToken ||
    !startResult.uploadSessionId
  ) {
    throw new Error(startResult.error ?? `${params.path} の開始に失敗しました`);
  }

  params.onStarted?.({
    shareId: startResult.shareId,
    analyticsTransferId: startResult.analyticsTransferId,
  });

  await uploadChunksFromStream(
    params.createChunkStream(),
    startResult.uploadSessionId,
    startResult.uploadToken,
    params.path,
    params.concurrency,
    params.onBytesUploaded
  );

  const completeResponse = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadSessionId: startResult.uploadSessionId,
      uploadToken: startResult.uploadToken,
    }),
  });

  const completeResult =
    await parseJsonOrEmpty<UploadCompleteResponse>(completeResponse);

  if (!completeResponse.ok || !completeResult.success) {
    throw new Error(
      completeResult.error ?? `${params.path} の完了処理に失敗しました`
    );
  }

  return {
    shareId: startResult.shareId,
    uploadToken: startResult.uploadToken,
    analyticsTransferId: startResult.analyticsTransferId,
  };
}
