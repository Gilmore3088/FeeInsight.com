import { unstable_cache, revalidateTag } from "next/cache";
import { getFeeCategorySummaries, type FeeCategorySummary } from "./fees";
import { PUBLIC_READ_CACHE_TAG } from "./public-read-cache";

/**
 * Cached read path for national fee summaries.
 *
 * `getFeeCategorySummaries()` scans every approved row in `published_fee_catalog` and
 * aggregates in JS. The result changes only when Hamilton publishes, so a page view is
 * the wrong cadence to recompute it on. Cached against a tag that the publish run
 * invalidates, with a time-based ceiling as a backstop if a publish path ever forgets.
 */

export const FEE_SUMMARY_CACHE_TAG = "fee-category-summaries";

const CACHE_CEILING_SECONDS = 3600;

const cachedSummaries = unstable_cache(
  async () => getFeeCategorySummaries(),
  ["fee-category-summaries", "v2"],
  { tags: [FEE_SUMMARY_CACHE_TAG], revalidate: CACHE_CEILING_SECONDS },
);

/** National fee summaries, served from cache between publishes. */
export async function getCachedFeeCategorySummaries(): Promise<FeeCategorySummary[]> {
  return cachedSummaries();
}

/**
 * Invalidate the cached national summaries. Called after a Hamilton publish writes new
 * rows, so readers see fresh benchmarks without waiting out the ceiling.
 *
 * The other public aggregate reads (public-read-cache.ts) are left to their hour-long
 * ceiling: the pipeline publishes every few minutes, and expiring them on each publish
 * re-ran a dozen catalog-wide aggregates (the state directory alone takes over a
 * minute on a busy database) as soon as visitors arrived. Paths that remove published
 * fees call invalidatePublicReadCache() as well.
 *
 * Safe to call outside a request scope — a publish may run from a job context where
 * `revalidateTag` is unavailable, and a failure to invalidate must never fail a publish.
 */
export function invalidateFeeSummaryCache(): void {
  revalidateQuietly(FEE_SUMMARY_CACHE_TAG);
}

/** Invalidate every public aggregate read. For paths that take published fees down. */
export function invalidatePublicReadCache(): void {
  revalidateQuietly(FEE_SUMMARY_CACHE_TAG);
  revalidateQuietly(PUBLIC_READ_CACHE_TAG);
}

function revalidateQuietly(tag: string): void {
  try {
    // Next 16 requires a cache-life profile. "max" is the broadest bucket, so it
    // certainly covers these entries' hour-long lifetime.
    revalidateTag(tag, "max");
  } catch {
    // Outside a Next request/render scope — a publish may run from a job context.
    // The time ceiling still bounds staleness, and a publish must never fail on this.
  }
}
