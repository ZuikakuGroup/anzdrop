// 非同期イテラブルを、最大capacity件まで先読みしてバッファするジェネレータに変換する。
// バッファが満杯の間は生成元(source)の消費を止める(バックプレッシャー)ため、
// 先読み分をcapacity件以内に抑えつつ、消費側の待ち時間を生成側の先行実行で隠せる。
export function bufferAhead<T>(
  source: AsyncIterable<T>,
  capacity: number,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const queue: T[] = [];
  let producerDone = false;
  let stopped = signal?.aborted ?? false;
  let pendingNext = false;
  let producerError: unknown = null;
  let notifyProducer: (() => void) | null = null;
  let notifyConsumer: (() => void) | null = null;

  const wake = (
    slot: "notifyProducer" | "notifyConsumer"
  ): void => {
    if (slot === "notifyProducer" && notifyProducer) {
      const fn = notifyProducer;
      notifyProducer = null;
      fn();
    } else if (slot === "notifyConsumer" && notifyConsumer) {
      const fn = notifyConsumer;
      notifyConsumer = null;
      fn();
    }
  };

  const iterator = source[Symbol.asyncIterator]();
  const pump = (async (): Promise<void> => {
    try {
      while (!stopped) {
        while (!stopped && queue.length >= capacity) {
          await new Promise<void>((resolve) => {
            notifyProducer = resolve;
          });
        }
        if (stopped) break;
        pendingNext = true;
        let result: IteratorResult<T>;
        try {
          result = await iterator.next();
        } finally {
          pendingNext = false;
        }
        const { value, done } = result;
        if (done || stopped) break;
        queue.push(value);
        wake("notifyConsumer");
      }
    } catch (err) {
      producerError = err;
    } finally {
      producerDone = true;
      wake("notifyConsumer");
      if (stopped) await iterator.return?.();
    }
  })();

  const onAbort = (): void => {
    stopped = true;
    queue.length = 0;
    wake("notifyProducer");
    wake("notifyConsumer");
    void pump.catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return (async function* (): AsyncGenerator<T> {
    try {
      while (true) {
        while (queue.length === 0 && !producerDone && !stopped) {
          await new Promise<void>((resolve) => {
            notifyConsumer = resolve;
          });
        }

        if (stopped) return;
        if (queue.length > 0) {
          const item = queue.shift() as T;
          wake("notifyProducer");
          yield item;
          continue;
        }

        await pump;

        if (producerError) {
          throw producerError;
        }

        return;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      stopped = true;
      queue.length = 0;
      wake("notifyProducer");
      // 生成中のチャンクは完了後に破棄して閉じる。呼び出し側の終了は待たせない。
      if (pendingNext) {
        void pump.catch(() => {});
      } else {
        await pump;
      }
    }
  })();
}
