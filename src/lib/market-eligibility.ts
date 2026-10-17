import { isBusinessOnlyLink } from "@/lib/agents/magellan/link-coverage";
import { notComparableReason } from "@/lib/fee-comparability";

/**
 * The one test for whether a published fee is placed against a market median, run on both sides
 * of a comparison (James's review, 2026-10-17): the institution's own fees on its profile, and
 * every other institution's fees inside the state, district and U.S. medians that profile quotes
 * (fee-index.ts getComparableMarketIndex). A rule added here moves both sides at once, so the
 * subject never gets cleaner eligibility than the population it is benchmarked against.
 *
 * It is the statistics contract's row rules (fee-stats.ts, rules 1, 3 and 6: sourced, a real
 * non-negative amount, not business, not from a business-only schedule) plus the comparability
 * rule (fee-comparability.ts: a CD or IRA fee, a card's inactivity fee or a safe deposit service
 * charge filed under a category that measures something else). Read-time only; no data changes.
 */

/** Audiences the statistics count (fee-stats.ts rule 6); business never does. A blank one is unknown. */
export const MARKET_AUDIENCES: readonly string[] = ["consumer", "both", "unknown"];

/**
 * Words isBusinessOnlyLink needs to see in an address, plus "%" for an encoded one, case ignored.
 * A market read fetches a row's address only when it matches, so the address test below runs on
 * exactly the rows it could flag. Plain alternation, valid in JavaScript and Postgres `~*`.
 */
export const BUSINESS_URL_SCREEN = "business|commercial|corporate|treasury|%";

export interface MarketEligibilityInput {
  category: string | null | undefined;
  amount: number | null | undefined;
  audience: string | null | undefined;
  /** The row traces to a fetched source document (statistics rule 1). */
  sourced: boolean;
  sourceUrl: string | null | undefined;
  feeName: string | null | undefined;
  accountProduct: string | null | undefined;
  sourceLine: string | null | undefined;
}

export type MarketIneligibleReason = "no_amount" | "unsourced" | "business" | "business_schedule" | "not_comparable";

/** Why a fee is left out of a market comparison, or null when it counts. */
export function marketIneligibleReason(fee: MarketEligibilityInput): MarketIneligibleReason | null {
  if (!fee.category || fee.amount == null || !Number.isFinite(fee.amount) || fee.amount < 0) return "no_amount";
  if (!fee.sourced) return "unsourced";
  // An audience left blank is unstated, as everywhere else (fee-audience isAudienceUnstated).
  if (!MARKET_AUDIENCES.includes(fee.audience ?? "unknown")) return "business";
  if (fee.sourceUrl && isBusinessOnlyLink(fee.sourceUrl)) return "business_schedule";
  if (notComparableReason(fee.category, fee.feeName, fee.accountProduct, fee.sourceLine) !== null) return "not_comparable";
  return null;
}

/** True when the fee is placed against the market's medians and ranges. */
export function countsInMarketComparison(fee: MarketEligibilityInput): boolean {
  return marketIneligibleReason(fee) === null;
}
