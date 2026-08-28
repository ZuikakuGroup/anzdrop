// パート番号はR2のマルチパートアップロード上で順不同に受け付けられるため、
// チャンクを並列アップロードして1ラウンドトリップあたりの待ち時間を隠す。
// chunksは非同期ジェネレータ(暗号化が終わったチャンクから順に届く)で、
// 呼び出し中の.next()はソース側で発行順に処理されるため、複数ワーカーが
// 同時にnext()を呼んでも受け取る順序は暗号化された順序と一致する。
// concurrencyはプラン別(lib/plan.tsのgetUploadConcurrencyForPlan)に呼び出し元が決める。
export async function uploadChunksFromStream(
  chunks: AsyncGenerator<Uint8Array>,
  uploadSessionId: string,
  uploadToken: string,
  path: string,
  concurrency: number,
  onChunkUploaded: () => void
): Promise<void> {
  let nextPartNumber = 1;
  let firstError: Error | null = null;

  const worker = async (): Promise<void> => {
    while (firstError === null) {
      let value: Uint8Array | undefined;
      let done: boolean | undefined;

      try {
        ({ value, done } = await chunks.next());
      } catch (unknownErr) {
        firstError =
          unknownErr instanceof Error
            ? unknownErr
            : new Error("Unknown error");
        return;
      }

      if (done || !value) {
        return;
      }

      const chunk = value;
      const partNumber = nextPartNumber++;
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
            "Anzdrop-Upload-Token": uploadToken,
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

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (firstError) {
    throw firstError;
  }
}
