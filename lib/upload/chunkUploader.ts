import { UPLOAD_PART_SIZE } from "./partSize";

// サーバー側の MAX_PART_URLS_PER_REQUEST(lib/upload/uploadSessionAuth.ts)と揃える。
// クライアントバンドルに D1 認可ヘルパを引き込まないよう、ここには定数だけ置く。
const PART_URL_BATCH_SIZE = 32;

type UploadMode = "direct" | "proxy";

// 暗号化チャンクのストリームを、パケット境界とは無関係にpartSizeちょうどで
// 切り出し直す。最後のパートだけがpartSize未満(0より大きい)になる。
// R2の「最終パート以外は同一サイズ」制約を満たすため(GitHub issue #34)。
// exportはテストからの単体検証のため(通常はuploadChunksFromStream経由で使う)。
export async function* repartition(
  source: AsyncGenerator<Uint8Array>,
  partSize: number
): AsyncGenerator<{ partNumber: number; body: Uint8Array<ArrayBuffer> }> {
  const pending: Uint8Array[] = [];
  let pendingLength = 0;
  let partNumber = 1;

  // pendingの先頭からlengthバイトを取り出して、byteOffset=0・buffer長ちょうどの
  // 1つのUint8Arrayにまとめる(呼び出し側がpendingLength >= lengthを保証する)。
  const take = (length: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const piece = pending[0];
      const need = length - offset;

      if (piece.byteLength <= need) {
        out.set(piece, offset);
        offset += piece.byteLength;
        pending.shift();
      } else {
        out.set(piece.subarray(0, need), offset);
        pending[0] = piece.subarray(need);
        offset += need;
      }
    }

    pendingLength -= length;
    return out;
  };

  for await (const piece of source) {
    if (piece.byteLength === 0) {
      continue;
    }

    pending.push(piece);
    pendingLength += piece.byteLength;

    while (pendingLength >= partSize) {
      yield { partNumber: partNumber++, body: take(partSize) };
    }
  }

  if (pendingLength > 0) {
    yield { partNumber: partNumber++, body: take(pendingLength) };
  }
}

// パート送信のリトライ設定。一時的な通信断・スリープ復帰・回線切替・サーバー側の
// 一時エラー(5xx / 429)で大容量アップロードが丸ごとやり直しにならないよう、
// パート単位で指数バックオフ付きリトライする(GitHub issue #65)。
// /api/upload/chunk は同じパート番号の再送に対して冪等(INSERT OR REPLACE)。
//
// 6 回・バックオフ合計 ~15.5s(0.5 + 1 + 2 + 4 + 8)まで粘る。これを超える
// 通信断(長いスリープ復帰など)は、ユーザーが「アップロードする」を押し直す
// ことで /api/upload/start から新しいセッションでやり直す(未送信パートだけを
// 送り直す本格的な再開は、暗号化フォーマットの再設計が必要なため別 issue)。
const PART_UPLOAD_MAX_ATTEMPTS = 6;

// リトライして意味がある(サーバー側/経路の一時的な問題)HTTPステータス。
// 520-524 は Cloudflare がオリジン/エッジの一時障害・タイムアウト時に返す。
// それ以外の4xx(トークン不一致・パート番号超過など)は再送しても直らないため
// 即座に失敗させる。
const RETRYABLE_STATUS = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

type RetryOptions = {
  // 1パートあたりの最大試行回数(初回含む)。
  maxAttempts?: number;
  // n回目の試行が失敗したあと、次の試行まで待つミリ秒。
  backoffMs?: (attempt: number) => number;
  // 待機の実体(テストで差し替え可能)。
  sleep?: (ms: number) => Promise<void>;
};

type UploadChunksOptions = RetryOptions & {
  // start が返す uploadMode。未指定時は従来どおり Worker プロキシ。
  uploadMode?: UploadMode;
};

function defaultBackoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, ... を上限8sでクランプし、最大±25%のジッターを足す。
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * base * 0.25);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function normalizeEtag(etag: string | null): string | null {
  if (!etag) {
    return null;
  }
  // S3/R2 の ETag ヘッダは引用符付きで返ることが多い。バインディング経路の
  // uploadPart().etag と揃えるため外す。
  return etag.replaceAll('"', "");
}

type PartUrlBatcher = {
  getUrl: (partNumber: number, contentLength: number) => Promise<string>;
};

function createPartUrlBatcher(
  uploadSessionId: string,
  uploadToken: string
): PartUrlBatcher {
  type Waiter = {
    partNumber: number;
    contentLength: number;
    resolve: (url: string) => void;
    reject: (error: unknown) => void;
  };

  const queue: Waiter[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;

  const runFlush = (): Promise<void> => {
    if (flushing) {
      return flushing;
    }

    flushing = (async () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      while (queue.length > 0) {
        const batch = queue.splice(0, PART_URL_BATCH_SIZE);
        // 同じパート番号は最後の contentLength を採用。
        const parts = [
          ...new Map(
            batch.map((item) => [
              item.partNumber,
              {
                partNumber: item.partNumber,
                contentLength: item.contentLength,
              },
            ] as const)
          ).values(),
        ];

        try {
          const response = await fetch("/api/upload/part-urls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uploadSessionId,
              uploadToken,
              parts,
            }),
          });

          if (!response.ok) {
            throw new Error("パート用URLの取得に失敗しました");
          }

          const body = (await response.json()) as {
            success?: boolean;
            urls?: Array<{ partNumber: number; url: string }>;
          };

          if (!body.success || !body.urls) {
            throw new Error("パート用URLの取得に失敗しました");
          }

          const byPart = new Map(
            body.urls.map((entry) => [entry.partNumber, entry.url])
          );

          for (const waiter of batch) {
            const url = byPart.get(waiter.partNumber);
            if (!url) {
              waiter.reject(new Error("パート用URLが見つかりません"));
              continue;
            }
            waiter.resolve(url);
          }
        } catch (error) {
          for (const waiter of batch) {
            waiter.reject(error);
          }
        }
      }
    })().finally(() => {
      flushing = null;
      if (queue.length > 0) {
        scheduleFlush();
      }
    });

    return flushing;
  };

  const scheduleFlush = () => {
    if (flushTimer !== null || flushing) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void runFlush();
    }, 0);
  };

  return {
    getUrl: (partNumber: number, contentLength: number) =>
      new Promise<string>((resolve, reject) => {
        queue.push({ partNumber, contentLength, resolve, reject });
        if (queue.length >= PART_URL_BATCH_SIZE) {
          void runFlush();
        } else {
          scheduleFlush();
        }
      }),
  };
}

async function ackUploadedPart(
  uploadSessionId: string,
  uploadToken: string,
  partNumber: number,
  etag: string
): Promise<void> {
  const response = await fetch("/api/upload/part-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadSessionId,
      uploadToken,
      parts: [{ partNumber, etag }],
    }),
  });

  if (!response.ok) {
    throw new Error("パート完了の記録に失敗しました");
  }
}

// 暗号化済みチャンクのストリームを受け取り、R2のマルチパートアップロードへ
// パートとして送信する。ストリームはrepartitionでUPLOAD_PART_SIZE単位に
// 詰め直してから送るため、パート番号はR2上で順不同に受け付けられる前提で
// チャンクを並列アップロードして1ラウンドトリップあたりの待ち時間を隠す。
// concurrencyはプラン別(lib/plan.tsのgetUploadConcurrencyForPlan)に呼び出し元が決める。
// onBytesUploadedには、各パートの送信成功ごとにそのパートのバイト数を渡す。
//
// uploadMode=direct のときは署名付きURLでブラウザからR2へ直接PUTし、
// ETagだけをWorkerへ記録する。proxyのときは従来どおり/api/upload/chunk経由。
//
// 各パートは一時エラー時に指数バックオフ付きでリトライする。リトライを
// 使い切ったパートがあった時点で全ワーカーを止め、アップロード全体を失敗させる。
export async function uploadChunksFromStream(
  chunks: AsyncGenerator<Uint8Array>,
  uploadSessionId: string,
  uploadToken: string,
  path: string,
  concurrency: number,
  onBytesUploaded: (bytes: number) => void,
  options: UploadChunksOptions = {}
): Promise<void> {
  const uploadMode = options.uploadMode ?? "proxy";
  const parts = repartition(chunks, UPLOAD_PART_SIZE);
  const maxAttempts = options.maxAttempts ?? PART_UPLOAD_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? defaultBackoffMs;
  const sleep = options.sleep ?? defaultSleep;
  const urlBatcher =
    uploadMode === "direct"
      ? createPartUrlBatcher(uploadSessionId, uploadToken)
      : null;

  let firstError: Error | null = null;

  const partFailure = (partNumber: number): Error =>
    new Error(`${path} のパート ${partNumber} アップロードに失敗しました`);

  const uploadPartProxy = async (
    partNumber: number,
    body: Uint8Array<ArrayBuffer>
  ): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      if (firstError !== null) {
        return;
      }

      let response: Response;

      try {
        response = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Anzdrop-Upload-Session": uploadSessionId,
            "Anzdrop-Part-Number": String(partNumber),
            "Anzdrop-Upload-Token": uploadToken,
          },
          // takeがbyteOffset=0・buffer長ちょうどのビューを返すため、
          // body.bufferがそのままこのパートのペイロード全体になる。
          body: body.buffer,
        });
      } catch (unknownErr) {
        if (attempt >= maxAttempts || firstError !== null) {
          throw unknownErr instanceof Error
            ? unknownErr
            : new Error("不明なエラー");
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (firstError !== null) {
        return;
      }

      if (response.ok) {
        onBytesUploaded(body.byteLength);
        return;
      }

      if (
        !RETRYABLE_STATUS.has(response.status) ||
        attempt >= maxAttempts ||
        firstError !== null
      ) {
        throw partFailure(partNumber);
      }

      await sleep(backoffMs(attempt));
    }
  };

  const uploadPartDirect = async (
    partNumber: number,
    body: Uint8Array<ArrayBuffer>
  ): Promise<void> => {
    if (!urlBatcher) {
      throw new Error("direct upload is not configured");
    }

    for (let attempt = 1; ; attempt++) {
      if (firstError !== null) {
        return;
      }

      try {
        const url = await urlBatcher.getUrl(partNumber, body.byteLength);
        // Content-Length は署名対象だが、ブラウザでは forbidden header のため
        // ここでは付けない。fetch がボディ長から自動設定し、申告どおりなら署名と一致する。
        const putResponse = await fetch(url, {
          method: "PUT",
          body: body.buffer,
        });

        if (firstError !== null) {
          return;
        }

        if (!putResponse.ok) {
          if (
            !RETRYABLE_STATUS.has(putResponse.status) ||
            attempt >= maxAttempts
          ) {
            throw partFailure(partNumber);
          }
          await sleep(backoffMs(attempt));
          continue;
        }

        const etag = normalizeEtag(putResponse.headers.get("ETag"));
        if (!etag) {
          throw partFailure(partNumber);
        }

        await ackUploadedPart(uploadSessionId, uploadToken, partNumber, etag);
        onBytesUploaded(body.byteLength);
        return;
      } catch (unknownErr) {
        if (attempt >= maxAttempts || firstError !== null) {
          throw unknownErr instanceof Error
            ? unknownErr
            : partFailure(partNumber);
        }
        await sleep(backoffMs(attempt));
      }
    }
  };

  const uploadPart =
    uploadMode === "direct" ? uploadPartDirect : uploadPartProxy;

  const worker = async (): Promise<void> => {
    while (firstError === null) {
      let next: IteratorResult<{
        partNumber: number;
        body: Uint8Array<ArrayBuffer>;
      }>;

      try {
        // 非同期ジェネレータのnext()は同時呼び出しでも発行順に直列化されるため、
        // 複数ワーカーが同時にnext()を呼んでもパート番号とバイト列は1対1で対応する。
        next = await parts.next();
      } catch (unknownErr) {
        firstError ??=
          unknownErr instanceof Error
            ? unknownErr
            : new Error("不明なエラー");
        return;
      }

      if (next.done) {
        return;
      }

      const { partNumber, body } = next.value;

      try {
        await uploadPart(partNumber, body);
      } catch (unknownErr) {
        firstError ??=
          unknownErr instanceof Error
            ? unknownErr
            : new Error("不明なエラー");
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (firstError) {
    throw firstError;
  }
}
