/**
 * Price scenarios for one fee: where a tested amount would sit among peers, and what it does to
 * fee income. Neutral by design: it reports consequences and never picks an option.
 *
 * Evidence levels:
 *  - "market": position only, from peers' published fees. No dollar total.
 *  - "institution": totals from figures the bank entered (paid items, waiver rate).
 */

export type EvidenceLevel = "market" | "institution";

export interface BankFigures {
  /** Paid items a year (for overdraft: overdrafts charged). */
  paidItems?: number | null;
  /** Share of charged items later waived or refunded, 0 to 1. */
  waiverRate?: number | null;
}

export interface ScenarioResult {
  current: number;
  tested: number;
  n: number;
  peersMore: number;
  peersSame: number;
  peersLess: number;
  /** Change in fee income per 1,000 paid items a year, before waivers. */
  per1000Delta: number;
  /** Yearly change in fee income from the bank's own figures; null without them. */
  annualDelta: number | null;
  evidence: EvidenceLevel;
}

export function peerPosition(peerAmounts: readonly number[], amount: number) {
  let more = 0;
  let same = 0;
  let less = 0;
  for (const a of peerAmounts) {
    if (a > amount) more++;
    else if (a === amount) same++;
    else less++;
  }
  return { n: peerAmounts.length, more, same, less };
}

export function modelScenario(
  peerAmounts: readonly number[],
  current: number,
  tested: number,
  figures: BankFigures = {},
): ScenarioResult {
  const pos = peerPosition(peerAmounts, tested);
  const perItem = tested - current;
  const paid = figures.paidItems != null && figures.paidItems > 0 ? figures.paidItems : null;
  const waiver = figures.waiverRate != null ? Math.min(Math.max(figures.waiverRate, 0), 1) : 0;
  return {
    current,
    tested,
    n: pos.n,
    peersMore: pos.more,
    peersSame: pos.same,
    peersLess: pos.less,
    per1000Delta: Math.round(perItem * 1000),
    annualDelta: paid == null ? null : Math.round(perItem * paid * (1 - waiver)),
    evidence: paid == null ? "market" : "institution",
  };
}

/** Peer counts in plain-language price bands for the distribution exhibit. */
export function priceBands(peerAmounts: readonly number[], edges: readonly number[]) {
  const sorted = [...edges].sort((a, b) => a - b);
  const bands = sorted.map((lo, i) => ({ lo, hi: sorted[i + 1] ?? null, count: 0 }));
  const zero = { lo: 0, hi: 0, count: 0 };
  for (const a of peerAmounts) {
    if (a === 0) {
      zero.count++;
      continue;
    }
    for (let i = bands.length - 1; i >= 0; i--) {
      if (a >= bands[i].lo) {
        bands[i].count++;
        break;
      }
    }
  }
  return [zero, ...bands.filter((b) => b.lo > 0)];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
