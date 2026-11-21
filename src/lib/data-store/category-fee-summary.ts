import { summarizeFees, summarizeFeesBy, type FeeStatistics } from "./fee-stats";
import type { FeeInstance } from "./fees";

/**
 * The /fees/[category] page's own national figures, from the category read's sourced rows:
 * every institution counted once (summarizeFees), plus the bank and credit union medians.
 * Computed when the cache entry is built, so the entry carries these few numbers instead of
 * every fee row: with the rows, the largest categories passed Next's 2 MB cache limit (safe
 * deposit box about 6 MB on Nov 21 2026) and were read from the database on every request.
 * Null when the read has no sourced rows (the page then falls back to the shared snapshot).
 */
export interface CategoryFeeSummary {
  all: FeeStatistics;
  bank_median_amount: number | null;
  cu_median_amount: number | null;
}

export function categoryFeeSummary(category: string, fees: FeeInstance[]): CategoryFeeSummary | null {
  const rows = fees.filter((f) => f.source_document_id !== null).map((f) => ({ ...f, fee_category: category }));
  if (rows.length === 0) return null;
  const byCharter = summarizeFeesBy(rows, (r) => (r.charter_type === "bank" || r.charter_type === "credit_union" ? r.charter_type : null));
  return {
    all: summarizeFees(rows),
    bank_median_amount: byCharter.get("bank")?.median_amount ?? null,
    cu_median_amount: byCharter.get("credit_union")?.median_amount ?? null,
  };
}
