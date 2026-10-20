/**
 * An optional read for a cached page: its value, or `fallback` when it fails, with whether
 * it failed, so the page can shorten its cache life (`shortenPageLife`) after a fallback.
 */
export function softRead<T>(read: Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  return read.then(
    (value) => ({ value, failed: false }),
    () => ({ value: fallback, failed: true }),
  );
}
