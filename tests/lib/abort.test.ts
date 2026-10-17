import { describe, expect, it } from "vitest";
import { abortable } from "@/lib/abort";

describe("abortable", () => {
  it.each([false, true])("preserves operation results and failures (signal=%s)", async withSignal => {
    const signal = withSignal ? new AbortController().signal : undefined;
    await expect(abortable(Promise.resolve(42), signal)).resolves.toBe(42);
    const failure = new Error("operation failed");
    await expect(abortable(Promise.reject(failure), signal)).rejects.toBe(failure);
  });

  it.each([false, true])("rejects on abort and observes a later operation failure (already aborted=%s)", async alreadyAborted => {
    const abort = new AbortController();
    const reason = new Error("cancelled");
    const operation = Promise.withResolvers<number>();
    if (alreadyAborted) abort.abort(reason);
    const result = abortable(operation.promise, abort.signal);
    if (!alreadyAborted) abort.abort(reason);
    await expect(result).rejects.toBe(reason);
    operation.reject(new Error("late failure"));
    await Promise.resolve();
  });
});
