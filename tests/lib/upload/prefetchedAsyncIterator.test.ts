import { describe, expect, it } from "vitest";
import {
  continuePrefetched,
  prefetchFirst,
} from "@/lib/upload/prefetchedAsyncIterator";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("prefetched async iterator", () => {
  it("starts the first item early and continues the same iterator without duplicates", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const produced: string[] = [];
    const source = (async function* () {
      produced.push("first-started");
      await firstGate;
      yield "first";
      produced.push("second-started");
      yield "second";
    })();

    const prefetched = prefetchFirst(source);
    await Promise.resolve();
    expect(produced).toEqual(["first-started"]);

    releaseFirst?.();
    const continued = continuePrefetched(prefetched);
    const first = await continued.next();
    expect(first).toEqual({ value: "first", done: false });
    expect(produced).toEqual(["first-started"]);

    expect(await collect(continued)).toEqual(["second"]);
    expect(produced).toEqual(["first-started", "second-started"]);
  });

  it("continues cleanly when the source has no items", async () => {
    const source = (async function* () {})();
    const continued = continuePrefetched(prefetchFirst(source));

    expect(await collect(continued)).toEqual([]);
  });

  it("propagates a first-item failure when the stream is consumed", async () => {
    const source = (async function* () {
      throw new Error("encryption failed");
    })();
    const continued = continuePrefetched(prefetchFirst(source));

    await expect(collect(continued)).rejects.toThrow("encryption failed");
  });
});
