import type { ExtractedFee } from "@/lib/data-store/types";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { pickHeadlineValues } from "../institution/[id]/profile-data";
import type { HeadlineRow, MarketBand } from "../institution/[id]/market-position";

/** The same count the institution page draws in full, so /check and the profile show the same rows. */
export const CHECK_ROWS_SHOWN = 6;

/** A market's band for one fee, only where enough institutions publish it for a median. */
export function marketBand(entry: IndexEntry | undefined): MarketBand | null {
  if (
    !entry ||
    entry.maturity_tier === "insufficient" ||
    entry.min_amount == null ||
    entry.p25_amount == null ||
    entry.median_amount == null ||
    entry.p75_amount == null ||
    entry.max_amount == null
  ) {
    return null;
  }
  return {
    min: entry.min_amount,
    p25: entry.p25_amount,
    median: entry.median_amount,
    p75: entry.p75_amount,
    max: entry.max_amount,
    institutions: entry.institution_count,
  };
}

/**
 * The headline rows exactly as the institution page builds them: one value per headline fee
 * (pickHeadlineValues), its home-state band for its own charter and the national band, kept
 * only where at least one market has a median.
 */
export function buildCheckRows(input: {
  verifiedFees: ExtractedFee[];
  nationalIndex: IndexEntry[];
  stateIndex: IndexEntry[];
  fallbackSourceUrl: string | null;
}): HeadlineRow[] {
  const nation = new Map(input.nationalIndex.map((entry) => [entry.fee_category, entry]));
  const state = new Map(input.stateIndex.map((entry) => [entry.fee_category, entry]));
  return pickHeadlineValues(input.verifiedFees, HEADLINE_FEE_KEYS)
    .map((value) => ({
      category: value.category,
      label: getDisplayName(value.category),
      amount: value.amount,
      spread: value.count > 1 && value.low !== value.high ? { count: value.count, low: value.low, high: value.high } : null,
      sourceUrl: value.sourceUrl ?? input.fallbackSourceUrl,
      state: marketBand(state.get(value.category)),
      nation: marketBand(nation.get(value.category)),
    }))
    .filter((row) => row.state !== null || row.nation !== null)
    .slice(0, CHECK_ROWS_SHOWN);
}

/** "Texas banks" when any row has a state band; null means every comparison is national. */
export function stateGroupLabel(rows: HeadlineRow[], stateName: string | null, charterType: string | null): string | null {
  if (!stateName || !rows.some((row) => row.state !== null)) return null;
  return `${stateName} ${charterType === "credit_union" ? "credit unions" : "banks"}`;
}

/** The id from `?id=`: a positive integer, or null. */
export function parseCheckId(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
