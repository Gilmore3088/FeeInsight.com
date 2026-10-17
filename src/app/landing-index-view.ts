/**
 * The hero card's data shape and the pure helpers its client component reads. No database
 * import, so the card's client bundle can use it; the server builder is landing-index.ts.
 */

/** The explorer's charter choice, as /fees spells it. */
export type Charter = "all" | "bank" | "credit_union";

export const CHARTERS: readonly Charter[] = ["all", "bank", "credit_union"];

/**
 * One pick's figures: institutions counted, then (when there are enough for a median) the
 * median, the middle half and the bars. A bar run is the first bar's lower bound, the step,
 * whether the run opens with an "under" bar and ends with an "and over" bar, then each bar's
 * count. A thin pick is its count alone.
 */
export interface IndexCell {
  n: number;
  median: number;
  p25: number;
  p75: number;
  /** Lower bound of the first even step, in cents. */
  lo: number;
  /** Step between bars, in cents. */
  step: number;
  under: boolean;
  over: boolean;
  counts: number[];
}

export type IndexPick = IndexCell | { n: number };

export interface IndexCardFee {
  key: string;
  label: string;
  /** "Median of each institution's median published price", as /fees words it. */
  headline: string;
  /** "institution medians" (or the highest-price wording for overdraft). */
  plural: string;
}

export interface IndexCardData {
  fees: IndexCardFee[];
  states: { code: string; name: string }[];
  /** cells[fee][place][charter index]: place is "US" or a state code. */
  cells: Record<string, Record<string, IndexPick[]>>;
}

export const US = "US";

export function hasMedian(pick: IndexPick | undefined): pick is IndexCell {
  return !!pick && "median" in pick;
}

/** A bar of the card's histogram: its bounds in dollars (null when open) and its count. */
export interface CardBar {
  min: number | null;
  max: number | null;
  total: number;
}

/** The bars of one pick, rebuilt from its run (the same bounds the /fees histogram uses). */
export function cellBars(c: IndexCell): CardBar[] {
  const bars: CardBar[] = [];
  let i = 0;
  if (c.under) bars.push({ min: null, max: (c.lo - 1) / 100, total: c.counts[i++] });
  const evenCount = c.counts.length - (c.under ? 1 : 0) - (c.over ? 1 : 0);
  for (let k = 0; k < evenCount; k++) {
    const start = c.lo + k * c.step;
    bars.push({ min: start / 100, max: (start + c.step - 1) / 100, total: c.counts[i++] });
  }
  if (c.over) bars.push({ min: (c.lo + evenCount * c.step) / 100, max: null, total: c.counts[i++] });
  return bars;
}

export function inBar(b: CardBar, value: number): boolean {
  return (b.min === null || value >= b.min) && (b.max === null || value < b.max + 0.01);
}

/** "$7" for whole dollars, "$6.95" otherwise, as /fees writes a figure. */
export function cardMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** The same pick on /fees, so "Open the Bank Fee Index" lands where the card was. */
export function cardHref(fee: string, place: string, charter: Charter): string {
  const q = new URLSearchParams({ fee });
  if (place !== US) q.set("state", place);
  if (charter !== "all") q.set("charter", charter);
  return `/fees?${q.toString()}#explorer`;
}
