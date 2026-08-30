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

// 暗号化済みチャンクのストリームを受け取り、R2のマルチパートアップロードへ
// パートとして送信する。ストリームはrepartitionでUPLOAD_PART_SIZE単位に
// 詰め直してから送るため、パート番号はR2上で順不同に受け付けられる前提で
// チャンクを並列アップロードして1ラウンドトリップあたりの待ち時間を隠す。
// concurrencyはプラン別(lib/plan.tsのgetUploadConcurrencyForPlan)に呼び出し元が決める。
// onBytesUploadedには、各パートの送信成功ごとにそのパートのバイト数を渡す。
export async function uploadChunksFromStream(
  chunks: AsyncGenerator<Uint8Array>,
  uploadSessionId: string,
  uploadToken: string,
  path: string,
  concurrency: number,
  onBytesUploaded: (bytes: number) => void
): Promise<void> {
  const parts = repartition(chunks, UPLOAD_PART_SIZE);
  let firstError: Error | null = null;

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
        const chunkResponse = await fetch("/api/upload/chunk", {
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

        if (!chunkResponse.ok) {
          throw new Error(
            `${path} のパート ${partNumber} アップロードに失敗しました`
          );
        }

        onBytesUploaded(body.byteLength);
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
