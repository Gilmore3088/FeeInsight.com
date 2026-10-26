import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { STATS_METHOD_VERSION } from "./fee-stats";

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
 * How long a render waits on a public read before it takes this server's last good value
 * instead. A fresh cache entry answers in milliseconds; only a missing or stale entry waits on
 * the database. On a cached (ISR) page render Next recomputes a stale entry in the foreground,
 * so once an agent's takedown invalidated the tag, every institution page waited on the
 * catalog-wide aggregates (10-50 s under load) and missed its 15 s read budget
 * (findings/2026-10-26-stale-public-reads-block-page-renders.md).
 */
export const STALE_GRACE_MS = 2000;

/** Most calls whose last good value one server keeps. Oldest used is dropped first. */
const LAST_GOOD_LIMIT = 400;

const lastGood = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

function remember(memoKey: string, value: unknown): void {
  lastGood.delete(memoKey);
  lastGood.set(memoKey, value);
  if (lastGood.size > LAST_GOOD_LIMIT) lastGood.delete(lastGood.keys().next().value as string);
}

/** One database read per call at a time on this server: concurrent renders share it. */
function shared<R>(memoKey: string, read: () => Promise<R>): Promise<R> {
  const running = inFlight.get(memoKey);
  if (running) return running as Promise<R>;
  const started = read().finally(() => inFlight.delete(memoKey));
  inFlight.set(memoKey, started);
  return started;
}

/** Keep a read the render stopped waiting for running, so it still refreshes the cache. */
function finishInBackground(read: Promise<unknown>, key: string): void {
  const settle = async () => {
    try { await read; }
    catch (error) { console.error(`[public-read-cache] ${key} background refresh failed:`, error); }
  };
  try {
    after(settle);
  } catch {
    // Outside a Next request there is no after(); the read still settles on its own.
    void settle();
  }
}

/**
 * Wrap a read in the public cache. `key` must be unique per function; arguments are
 * part of the cache key automatically. Results round-trip through JSON, so wrap only
 * reads whose results hold plain strings, numbers and arrays (no Date objects).
 *
 * A render never waits more than STALE_GRACE_MS on a recompute when this server already
 * holds a good value for the same call: it shows that value, shortens the page's cache life
 * so the page is rebuilt from the refreshed entry a minute later, and leaves the recompute
 * running. A read that fails within the grace still fails, as before: callers such as the
 * health check must see it.
 */
export function cachedPublicRead<A extends unknown[], R>(
  key: string,
  read: (...args: A) => Promise<R>,
  isEmpty: (value: R) => boolean = isEmptyRead,
): (...args: A) => Promise<R> {
  const cached = unstable_cache(
    async (...args: A) => {
      const value = await shared(`${key}:${JSON.stringify(args)}`, () => read(...args));
      if (isEmpty(value)) throw new UncacheableResult(value);
      return value;
    },
    // The statistics rules' version is part of every key, so a rule change (#1816 took safe deposit
    // service charges out of the medians) is never served from an entry computed before it.
    ["public-read", key, "consumer-audience-v2", `stats-v${STATS_METHOD_VERSION}`],
    { tags: [PUBLIC_READ_CACHE_TAG], revalidate: PUBLIC_READ_CEILING_SECONDS },
  );
  const load = async (args: A): Promise<R> => {
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
  return async (...args: A) => {
    const memoKey = `${key}:${JSON.stringify(args)}`;
    // Started on every call, so the page still carries the cache's tag and lifetime.
    const loading = load(args).then((value) => {
      if (!isEmpty(value)) remember(memoKey, value);
      return value;
    });
    if (!lastGood.has(memoKey)) return loading;
    const held = lastGood.get(memoKey) as R;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), STALE_GRACE_MS); });
    try {
      const outcome = await Promise.race([loading.then((value) => ({ value })), grace]);
      if (outcome !== "slow") return outcome.value;
    } finally {
      clearTimeout(timer);
    }
    finishInBackground(loading, key);
    await shortenPageLife();
    // A copy, as a cache hit would give: a caller that sorts its rows cannot change the kept value.
    return structuredClone(held);
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
