// 暗号化済みファイル本体(/api/file/[fileId])を、複数の HTTP Range リクエストで
// 並列に取得し、1本の「順番どおりのバイト列」ReadableStream として見せる。
//
// ストレージ上のバイト列は「先頭のファイルsalt + 各パケットの連結」で、
// Range で切り出して連結し直しても単一ストリームと完全に同一になる(パケット
// 境界に依存しない)。そのため、この関数が返すストリームをそのまま
// iterateDecryptedChunks へ渡せば、復号・改ざん検知・切り詰め検知は一切
// 変更せずに機能する。
//
// 単一 TCP コネクションの逐次ダウンロードは、遅延の大きい経路やパケットロスの
// ある回線で帯域を使い切れない。Range を並列化することで、1リクエストあたりの
// 往復待ち(Worker 起動・D1・R2 の取得レイテンシ)を隠し、実効ダウンロード
// 速度を上げる。回数制限のあるファイル(保存期間「1回」など)は、サーバー側の
// ダウンロード数カウントを1回に保つため呼び出し側で単一リクエストのまま残す。
//
// サーバーが Range を無視して 200 を返した場合(未対応時の保険)は、最初の
// リクエストのレスポンス本体をそのまま単一ストリームとして返す。2本目以降の
// ウィンドウで 206 以外が返った場合は、全体本体をウィンドウ位置へ混ぜて壊さない
// よう、そのダウンロードを失敗させて呼び出し側の再試行に委ねる。

import { FileGoneError, FriendlyError, FILE_GONE_ERROR } from "./errors";

// 1 Range リクエストで取得するバイト数。大きいほどリクエスト数(= Worker/D1/R2
// の固定コスト)は減るが、送信中に同時展開されるメモリ(下記 maxAhead 分)が
// 増える。8 MiB は暗号化1チャンク(PACKED_CHUNK_SIZE ≒ 8 MiB)とほぼ同じ粒度。
export const DOWNLOAD_WINDOW_SIZE = 8 * 1024 * 1024;

// Range リクエストの並列本数。
export const DOWNLOAD_CONCURRENCY = 6;

// 1リクエストあたりの最大試行回数(初回含む)。一時的な失敗で大容量
// ダウンロードが丸ごとやり直しにならないよう、リクエスト単位でリトライする。
const MAX_REQUEST_ATTEMPTS = 4;

// リトライして意味のある(サーバー側・経路の一時的な問題)HTTP ステータス。
// chunkUploader.ts のアップロード側と同じ集合。
const RETRYABLE_STATUS = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

type ParallelOptions = {
  windowSize?: number;
  concurrency?: number;
  // テスト差し替え用。
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 4000);
  return base + Math.floor(Math.random() * base * 0.25);
}

// "bytes 0-8388607/524288000" の末尾 "/<total>" を取り出す。
function parseTotalFromContentRange(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const match = /\/\s*(\d+)\s*$/.exec(header);

  if (!match) {
    return null;
  }

  const total = Number(match[1]);

  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// 1本の Range リクエストを、一時エラー(リトライ可能なステータス・fetch 自体の
// 失敗)時に指数バックオフ付きで最大 MAX_REQUEST_ATTEMPTS 回まで試す。
// abort されたら AbortError をそのまま投げ直す。ステータスの意味づけ(404 →
// FileGoneError、206 以外の扱いなど)は呼び出し側に委ねる。
async function fetchRangeWithRetry(
  doFetch: typeof fetch,
  url: string,
  rangeHeader: string,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    try {
      const response = await doFetch(url, {
        headers: { Range: rangeHeader },
        signal,
      });

      if (
        RETRYABLE_STATUS.has(response.status) &&
        attempt < MAX_REQUEST_ATTEMPTS
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }

      return response;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        throw err instanceof Error ? err : new DOMException("aborted", "AbortError");
      }

      // fetch 自体の失敗(通信断など)はリトライ対象。
      if (attempt < MAX_REQUEST_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }

      throw new FriendlyError("ダウンロードに失敗しました。");
    }
  }
}

function singleChunkStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

export async function createParallelCiphertextStream(
  url: string,
  options: ParallelOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const windowSize = Math.max(1, options.windowSize ?? DOWNLOAD_WINDOW_SIZE);
  const concurrency = Math.max(1, options.concurrency ?? DOWNLOAD_CONCURRENCY);
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  const firstResponse = await fetchRangeWithRetry(
    doFetch,
    url,
    `bytes=0-${windowSize - 1}`,
    sleep
  );

  if (firstResponse.status === 404) {
    throw new FileGoneError(FILE_GONE_ERROR);
  }

  if (!firstResponse.ok) {
    throw new FriendlyError("ダウンロードに失敗しました。");
  }

  // サーバーが Range に対応していない(200 を返した)。並列化は諦め、本体を
  // そのまま単一ストリームとして扱う(ここは最初のリクエストなので、本体全体
  // = ファイル全体で正しい)。
  if (firstResponse.status !== 206) {
    if (!firstResponse.body) {
      throw new FriendlyError("ダウンロードに失敗しました。");
    }
    return firstResponse.body;
  }

  const total = parseTotalFromContentRange(
    firstResponse.headers.get("Content-Range")
  );
  const firstBytes = new Uint8Array(await firstResponse.arrayBuffer());

  // 合計サイズが読めない、または最初のウィンドウで全部取得できた場合は、
  // 追加リクエストを出さずに手元のバイト列だけを流す。
  if (total === null || total <= firstBytes.byteLength) {
    return singleChunkStream(firstBytes);
  }

  const windowCount = Math.ceil(total / windowSize);

  return orderedWindowStream({
    url,
    doFetch,
    sleep,
    total,
    windowSize,
    windowCount,
    concurrency,
    firstBytes,
  });
}

type OrderedArgs = {
  url: string;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  total: number;
  windowSize: number;
  windowCount: number;
  concurrency: number;
  firstBytes: Uint8Array;
};

function orderedWindowStream(args: OrderedArgs): ReadableStream<Uint8Array> {
  const {
    url,
    doFetch,
    sleep,
    total,
    windowSize,
    windowCount,
    concurrency,
    firstBytes,
  } = args;

  // ウィンドウ index -> 取得済みバイト列。消費(enqueue)したら削除する。
  const buffers = new Map<number, Uint8Array>();
  buffers.set(0, firstBytes);

  let nextToEnqueue = 0;
  let nextToScheduleIndex = 1;
  let inFlight = 0;
  let failure: unknown = null;
  const abort = new AbortController();

  // 消費側(pull)が次のウィンドウ待ちで寝ているときに起こすための waiter。
  let wake: (() => void) | null = null;
  const signalConsumer = (): void => {
    if (wake) {
      const fn = wake;
      wake = null;
      fn();
    }
  };

  // buffered + in-flight のウィンドウ数をこの範囲に抑える(= 同時に確保する
  // メモリの上限を concurrency + 余裕 に固定する)。消費が遅ければ pump が
  // 新しい取得を始めないので、自然にバックプレッシャーがかかる。
  const maxAhead = concurrency + 2;

  const fetchWindow = async (index: number): Promise<void> => {
    const start = index * windowSize;
    const end = Math.min(start + windowSize, total) - 1;

    if (failure !== null || abort.signal.aborted) {
      return;
    }

    let response: Response;

    try {
      response = await fetchRangeWithRetry(
        doFetch,
        url,
        `bytes=${start}-${end}`,
        sleep,
        abort.signal
      );
    } catch (err) {
      if (isAbortError(err) || abort.signal.aborted) {
        return;
      }
      throw err instanceof FriendlyError
        ? err
        : new FriendlyError("ダウンロードに失敗しました。");
    }

    // ダウンロード中に共有が期限切れ掃除などで消えた場合。一覧から取り除ける
    // よう FileGoneError にする。
    if (response.status === 404) {
      throw new FileGoneError(FILE_GONE_ERROR);
    }

    // 2本目以降のウィンドウは 206(部分応答)以外を受け付けない。ここで 200
    // (全体本体)を許すと、ファイル全体が1ウィンドウの位置へ混ざって連結結果を
    // 壊す。異常時はこのダウンロードを失敗させ、呼び出し側の再試行に委ねる。
    if (response.status !== 206) {
      throw new FriendlyError("ダウンロードに失敗しました。");
    }

    buffers.set(index, new Uint8Array(await response.arrayBuffer()));
  };

  const pump = (): void => {
    while (
      failure === null &&
      !abort.signal.aborted &&
      inFlight < concurrency &&
      nextToScheduleIndex < windowCount &&
      nextToScheduleIndex - nextToEnqueue < maxAhead
    ) {
      const index = nextToScheduleIndex++;
      inFlight++;

      fetchWindow(index)
        .catch((err: unknown) => {
          failure ??= err;
        })
        .finally(() => {
          inFlight--;
          signalConsumer();
          pump();
        });
    }
  };

  return new ReadableStream<Uint8Array>({
    start() {
      pump();
    },
    async pull(controller) {
      for (;;) {
        // cancel() 後に pending だった pull が起こされたケース。ここで抜けないと
        // buffers が空のまま次の待ちに入り、二度と起こされずハングする。
        if (abort.signal.aborted) {
          return;
        }

        if (failure !== null) {
          controller.error(failure);
          return;
        }

        if (nextToEnqueue >= windowCount) {
          controller.close();
          return;
        }

        const ready = buffers.get(nextToEnqueue);

        if (ready) {
          buffers.delete(nextToEnqueue);
          nextToEnqueue++;
          pump();
          controller.enqueue(ready);
          return;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    cancel() {
      abort.abort();
      buffers.clear();
      signalConsumer();
    },
  });
}
