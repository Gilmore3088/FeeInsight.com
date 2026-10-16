import { unstable_cache } from "next/cache";

/**
 * Shared cache for the aggregate reads behind the public site.
 *
 * Public pages render on every request (most read the session for gating), and each
 * render used to re-run the same full-catalog aggregates: the homepage alone issued
 * nine of them. Those numbers only move when Hamilton publishes, so they are cached
 * here against one tag that the publish path invalidates (see fee-cache.ts), with a
 * time ceiling as the backstop.
 *
 * Several of the wrapped reads swallow database errors and return an empty result.
 * An empty result is therefore never cached: it is returned to the caller as is and
 * the next request tries the database again, so a blip cannot pin a blank page for
 * the whole ceiling. Once an entry exists, a stale entry is served while it refreshes
 * in the background, and a failed refresh keeps serving the last good value.
 */

export const PUBLIC_READ_CACHE_TAG = "public-fee-reads";

const PUBLIC_READ_CEILING_SECONDS = 3600;

class UncacheableResult<R> extends Error {
  constructor(readonly value: R) {
    super("uncacheable public read result");
  }
}

export function isEmptyRead(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Wrap a read in the public cache. `key` must be unique per function; arguments are
 * part of the cache key automatically. Results round-trip through JSON, so wrap only
 * reads whose results hold plain strings, numbers and arrays (no Date objects).
 */
export function cachedPublicRead<A extends unknown[], R>(
  key: string,
  read: (...args: A) => Promise<R>,
  isEmpty: (value: R) => boolean = isEmptyRead,
): (...args: A) => Promise<R> {
  const cached = unstable_cache(
    async (...args: A) => {
      const value = await read(...args);
      if (isEmpty(value)) throw new UncacheableResult(value);
      return value;
    },
    ["public-read", key, "consumer-audience-v2"],
    { tags: [PUBLIC_READ_CACHE_TAG], revalidate: PUBLIC_READ_CEILING_SECONDS },
  );
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (error) {
      if (error instanceof UncacheableResult) return error.value as R;
      // Outside a Next request (tests, one-off module use) there is no incremental
      // cache to read from; serve the read directly instead of failing.
      if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) {
        return read(...args);
      }
      throw error;
    }
  };
}

/** How long a page rendered with a failed read stays cached before it is rendered again. */
export const DEGRADED_PAGE_SECONDS = 60;

const degradedPageMarker = unstable_cache(async () => true, ["degraded-page-marker"], {
  revalidate: DEGRADED_PAGE_SECONDS,
});

/**
 * Shortens the cache life of the page being rendered to DEGRADED_PAGE_SECONDS (#1572).
 *
 * A cached page is kept for the shortest revalidate of the cached reads it made, so one
 * read with a 60-second life makes this render expire after a minute instead of the
 * page's usual 15. Call it when a render had a failed read: the visitor gets the page
 * (with the failed parts hidden) rather than an error, and the next render a minute
 * later tries the database again. The reads themselves still serve their last good
 * value while one exists (see cachedPublicRead), so a render only has a failed read
 * when no good value is cached at all.
 */
export async function shortenPageLife(): Promise<void> {
  try {
    await degradedPageMarker();
  } catch {
    // Outside a Next render there is no page cache to shorten.
  }
}
