export type PrefetchedAsyncIterator<T> = {
  iterator: AsyncGenerator<T>;
  firstResult: Promise<IteratorResult<T>>;
};

// Start producing the first item now and keep the same iterator for the rest
// of the stream. The rejection handler prevents an unhandled rejection while
// the user is still deciding whether to upload.
export function prefetchFirst<T>(
  iterator: AsyncGenerator<T>
): PrefetchedAsyncIterator<T> {
  const firstResult = iterator.next();
  void firstResult.catch(() => {});
  return { iterator, firstResult };
}

export async function* continuePrefetched<T>(
  prefetched: PrefetchedAsyncIterator<T>
): AsyncGenerator<T> {
  const first = await prefetched.firstResult;
  if (!first.done) {
    yield first.value;
  }

  yield* prefetched.iterator;
}
