import { unstable_cache, revalidateTag } from "next/cache";
import { getFeeCategorySummaries, type FeeCategorySummary } from "./fees";

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
  ["fee-category-summaries", "v1"],
  { tags: [FEE_SUMMARY_CACHE_TAG], revalidate: CACHE_CEILING_SECONDS },
);

/** National fee summaries, served from cache between publishes. */
export async function getCachedFeeCategorySummaries(): Promise<FeeCategorySummary[]> {
  return cachedSummaries();
}

/**
 * Invalidate the cached summaries. Called after a Hamilton publish writes new rows, so
 * readers see fresh benchmarks without waiting out the ceiling.
 *
 * Safe to call outside a request scope — a publish may run from a job context where
 * `revalidateTag` is unavailable, and a failure to invalidate must never fail a publish.
 */
export function invalidateFeeSummaryCache(): void {
  try {
    // Next 16 requires a cache-life profile. "max" is the broadest bucket, so it
    // certainly covers this entry's hour-long lifetime. Over-invalidating costs one
    // recompute; under-invalidating would serve stale benchmarks, so err broad.
    revalidateTag(FEE_SUMMARY_CACHE_TAG, "max");
  } catch {
    // Outside a Next request/render scope — a publish may run from a job context.
    // The time ceiling still bounds staleness, and a publish must never fail on this.
  }
}
