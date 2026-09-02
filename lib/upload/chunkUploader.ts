import { UPLOAD_PART_SIZE } from "./partSize";

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
const PART_UPLOAD_MAX_ATTEMPTS = 4;

// リトライして意味がある(サーバー側/経路の一時的な問題)HTTPステータス。
// それ以外の4xx(トークン不一致・パート番号超過など)は再送しても直らないため
// 即座に失敗させる。
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

type RetryOptions = {
  // 1パートあたりの最大試行回数(初回含む)。
  maxAttempts?: number;
  // n回目の試行が失敗したあと、次の試行まで待つミリ秒。
  backoffMs?: (attempt: number) => number;
  // 待機の実体(テストで差し替え可能)。
  sleep?: (ms: number) => Promise<void>;
};

function defaultBackoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, ... を上限8sでクランプし、最大±25%のジッターを足す。
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * base * 0.25);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// 暗号化済みチャンクのストリームを受け取り、R2のマルチパートアップロードへ
// パートとして送信する。ストリームはrepartitionでUPLOAD_PART_SIZE単位に
// 詰め直してから送るため、パート番号はR2上で順不同に受け付けられる前提で
// チャンクを並列アップロードして1ラウンドトリップあたりの待ち時間を隠す。
// concurrencyはプラン別(lib/plan.tsのgetUploadConcurrencyForPlan)に呼び出し元が決める。
// onBytesUploadedには、各パートの送信成功ごとにそのパートのバイト数を渡す。
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
  retry: RetryOptions = {}
): Promise<void> {
  const parts = repartition(chunks, UPLOAD_PART_SIZE);
  const maxAttempts = retry.maxAttempts ?? PART_UPLOAD_MAX_ATTEMPTS;
  const backoffMs = retry.backoffMs ?? defaultBackoffMs;
  const sleep = retry.sleep ?? defaultSleep;

  let firstError: Error | null = null;

  const partFailure = (partNumber: number): Error =>
    new Error(`${path} のパート ${partNumber} アップロードに失敗しました`);

  // 1パートを送信する。一時エラーはバックオフを挟んで最大 maxAttempts 回試す。
  const uploadPart = async (
    partNumber: number,
    body: Uint8Array<ArrayBuffer>
  ): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
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
        // fetch自体の失敗(通信断など)は常にリトライ対象。
        if (attempt >= maxAttempts || firstError !== null) {
          throw unknownErr instanceof Error
            ? unknownErr
            : new Error("不明なエラー");
        }
        await sleep(backoffMs(attempt));
        continue;
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
        firstError =
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
        firstError =
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
