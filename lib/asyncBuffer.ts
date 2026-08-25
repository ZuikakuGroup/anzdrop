// 非同期イテラブルを、最大capacity件まで先読みしてバッファするジェネレータに変換する。
// バッファが満杯の間は生成元(source)の消費を止める(バックプレッシャー)ため、
// メモリ使用量をcapacity件分に抑えつつ、消費側の待ち時間を生成側の先行実行で隠せる。
export function bufferAhead<T>(
  source: AsyncIterable<T>,
  capacity: number
): AsyncGenerator<T> {
  const queue: T[] = [];
  let producerDone = false;
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

  const pump = (async (): Promise<void> => {
    try {
      for await (const item of source) {
        while (queue.length >= capacity) {
          await new Promise<void>((resolve) => {
            notifyProducer = resolve;
          });
        }
        queue.push(item);
        wake("notifyConsumer");
      }
    } catch (err) {
      producerError = err;
    } finally {
      producerDone = true;
      wake("notifyConsumer");
    }
  })();

  return (async function* (): AsyncGenerator<T> {
    while (true) {
      while (queue.length === 0 && !producerDone) {
        await new Promise<void>((resolve) => {
          notifyConsumer = resolve;
        });
      }

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
  })();
}
