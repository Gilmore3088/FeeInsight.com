/**
 * Market-share helpers over HMDA lender aggregates (hmda_lender_originations): each lender's
 * share and rank in a market, the market's Herfindahl index, and medians that carry the count
 * they were taken over.
 *
 * Volumes are sums of HMDA's rounded loan amounts (each loan is reported at the midpoint of its
 * $10,000 bin), so dollar shares are close to, not exactly, the lenders' booked volumes.
 */

export interface HmdaShareInput {
  lei: string;
  lenderName: string | null;
  institutionId: number | null;
  originations: number;
  originationAmount: number;
}

export interface HmdaShareRow extends HmdaShareInput {
  rank: number;
  shareOfOriginations: number;
  shareOfAmount: number | null;
}

export interface MedianWithCount {
  median: number | null;
  count: number;
}

/** Exact median and the number of values it was taken over. */
export function medianWithCount(values: readonly number[]): MedianWithCount {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { median: null, count: 0 };
  const mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid], count: sorted.length };
}

/** Ranks lenders by originations (ties share a rank) and adds count and dollar shares. */
export function withMarketShares(rows: readonly HmdaShareInput[]): HmdaShareRow[] {
  const totalCount = rows.reduce((s, r) => s + r.originations, 0);
  const totalAmount = rows.reduce((s, r) => s + r.originationAmount, 0);
  const sorted = [...rows].sort((a, b) => b.originations - a.originations || b.originationAmount - a.originationAmount || a.lei.localeCompare(b.lei));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((r, i) => {
    if (r.originations !== previous) rank = i + 1;
    previous = r.originations;
    return {
      ...r,
      rank,
      shareOfOriginations: totalCount > 0 ? r.originations / totalCount : 0,
      shareOfAmount: totalAmount > 0 ? r.originationAmount / totalAmount : null,
    };
  });
}

/** HHI on count shares (shares as percentages squared and summed); null for an empty market. */
export function herfindahl(rows: readonly HmdaShareRow[]): number | null {
  if (rows.length === 0) return null;
  return Math.round(rows.reduce((s, r) => s + (r.shareOfOriginations * 100) ** 2, 0));
}
