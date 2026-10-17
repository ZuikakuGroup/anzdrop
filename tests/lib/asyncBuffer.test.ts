import { describe, expect, it, vi } from "vitest";
import { bufferAhead } from "@/lib/asyncBuffer";

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

  it.each([1, 3, 8])("stops reading at capacity %i until the consumer takes an item", async (capacity) => {
    const produced: number[] = [];
    const iterator = bufferAhead(range(12, produced), capacity);

    // Let the producer fill its queue while the consumer is paused.
    await sleep(10);
    expect(produced).toHaveLength(capacity);

    expect(await iterator.next()).toEqual({ value: 0, done: false });
    await sleep(10);
    // Only the newly freed slot may be filled, with no extra item held outside the queue.
    expect(produced).toHaveLength(capacity + 1);

    const rest: number[] = [];
    for await (const item of iterator) {
      rest.push(item);
    }
    expect(rest).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    expect(produced).toHaveLength(12);
  });

  it.each([1, 5])("propagates source errors after draining a queue of capacity %i", async (capacity) => {
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      throw new Error("boom");
    }

    const iterator = bufferAhead(failing(), capacity);
    const result: number[] = [];

    await expect(async () => {
      for await (const item of iterator) {
        result.push(item);
      }
    }).rejects.toThrow("boom");

    expect(result).toEqual([1, 2]);
  });

  it("closes the producer when a consumer stops with a full queue", async () => {
    const closed = vi.fn();
    let produced = 0;
    async function* source() {
      try { while (true) yield ++produced; }
      finally { closed(); }
    }
    const buffered = bufferAhead(source(), 2);
    await buffered.next();
    await vi.waitFor(() => expect(produced).toBe(3));
    await buffered.return(undefined);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(produced).toBe(3);
  });

  it.each(["resolve", "reject"] as const)("returns before a pending source read settles (%s), then observes cleanup failure", async outcome => {
    let resolveRead!: (result: IteratorResult<number>) => void;
    let rejectRead!: (error: Error) => void;
    const read = new Promise<IteratorResult<number>>((resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    });
    const iterator = {
      next: vi.fn<() => Promise<IteratorResult<number>>>()
        .mockResolvedValueOnce({ value: 1, done: false })
        .mockImplementation(() => read),
      return: vi.fn(async (): Promise<IteratorResult<number>> => {
        throw new Error("late cleanup failure");
      }),
    };
    const buffered = bufferAhead({ [Symbol.asyncIterator]: () => iterator }, 1);
    expect(await buffered.next()).toEqual({ value: 1, done: false });
    await vi.waitFor(() => expect(iterator.next).toHaveBeenCalledTimes(2));
    const returned = buffered.return(undefined);
    try {
      expect(await Promise.race([returned.then(() => "returned"), sleep(100).then(() => "blocked")])).toBe("returned");
      expect(iterator.return).not.toHaveBeenCalled();
    } finally {
      if (outcome === "resolve") resolveRead({ value: 2, done: false });
      else rejectRead(new Error("late read failure"));
      await returned.catch(() => {});
    }
    await vi.waitFor(() => expect(iterator.return).toHaveBeenCalledTimes(1));
    expect(iterator.next).toHaveBeenCalledTimes(2);
    await expect(buffered.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("supports an empty source", async () => {
    const result: number[] = [];

    for await (const item of bufferAhead(range(0, []), 3)) {
      result.push(item);
    }

    expect(result).toEqual([]);
  });
});
