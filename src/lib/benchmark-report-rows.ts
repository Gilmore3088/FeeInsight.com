/** Rows of a free benchmark report, built from the published fee index (server only). */
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { getDisplayName } from "@/lib/fee-taxonomy";

/** A line is shown only when at least this many institutions publish the fee. */
export const MIN_BENCHMARK_INSTITUTIONS = 20;

export interface BenchmarkRow {
  category: string;
  label: string;
  median: number;
  p25: number | null;
  p75: number | null;
  institutions: number;
  /** District reports only: the national median and the district's difference from it. */
  nationalMedian: number | null;
  deltaPct: number | null;
}

/**
 * One row per headline category with enough institutions behind it, in headline order.
 * `national` is the comparison set for a district report; pass null for the national one.
 */
export function buildBenchmarkRows(entries: IndexEntry[], national: IndexEntry[] | null): BenchmarkRow[] {
  const byCategory = new Map(entries.map((entry) => [entry.fee_category, entry]));
  const nationalByCategory = new Map((national ?? []).map((entry) => [entry.fee_category, entry]));
  const rows: BenchmarkRow[] = [];
  for (const category of HEADLINE_FEE_KEYS) {
    const entry = byCategory.get(category);
    if (!entry || entry.median_amount === null || entry.institution_count < MIN_BENCHMARK_INSTITUTIONS) continue;
    const nationalMedian = national ? (nationalByCategory.get(category)?.median_amount ?? null) : null;
    const deltaPct =
      nationalMedian !== null && nationalMedian > 0
        ? ((entry.median_amount - nationalMedian) / nationalMedian) * 100
        : null;
    rows.push({
      category,
      label: getDisplayName(category),
      median: entry.median_amount,
      p25: entry.p25_amount,
      p75: entry.p75_amount,
      institutions: entry.institution_count,
      nationalMedian,
      deltaPct,
    });
  }
  return rows;
}
