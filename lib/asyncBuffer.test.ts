import { describe, expect, it } from "vitest";
import { bufferAhead } from "./asyncBuffer";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* range(n: number, produced: number[]): AsyncGenerator<number> {
  for (let i = 0; i < n; i++) {
    produced.push(i);
    yield i;
  }
}

describe("bufferAhead", () => {
  it("yields all items from the source in order", async () => {
    const produced: number[] = [];
    const result: number[] = [];

    for await (const item of bufferAhead(range(10, produced), 3)) {
      result.push(item);
    }

    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("does not read more than `capacity` items ahead of the consumer", async () => {
    const produced: number[] = [];
    const iterator = bufferAhead(range(10, produced), 3);

    // consumerがまだ何も取り出していない間、先読みは高々capacity+1件で止まるはず
    // (+1は、キューに空きがあるか確認する前に生成元から1件引いてしまう分)。
    await sleep(10);
    expect(produced.length).toBeLessThanOrEqual(4);

    await iterator.next();
    await sleep(10);
    // 1件消費した分、また1件先読みが進む。
    expect(produced.length).toBeLessThanOrEqual(5);

    // 残りを全部消費すれば、生成元も最後まで進む。
    const rest: number[] = [];
    for await (const item of iterator) {
      rest.push(item);
    }
    expect(produced).toHaveLength(10);
  });

  it("propagates errors from the source", async () => {
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      throw new Error("boom");
    }

    const iterator = bufferAhead(failing(), 5);
    const result: number[] = [];

    await expect(async () => {
      for await (const item of iterator) {
        result.push(item);
      }
    }).rejects.toThrow("boom");

    expect(result).toEqual([1, 2]);
  });

  it("supports an empty source", async () => {
    const result: number[] = [];

    for await (const item of bufferAhead(range(0, []), 3)) {
      result.push(item);
    }

    expect(result).toEqual([]);
  });
});
