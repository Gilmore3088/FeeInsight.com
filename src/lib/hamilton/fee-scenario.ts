/**
 * Price scenarios for one fee: where a tested amount would sit among peers, and, only when the
 * bank supplies its own volumes, the arithmetic on fee income. Neutral by design: it reports
 * consequences and never picks an option.
 *
 * Evidence levels:
 *  - "market": position only, from peers' published fees. No fee income figure of any kind, not
 *    even per 1,000 items, because that needs a volume the bank never gave (#1896).
 *  - "institution": fee income arithmetic from figures the bank entered (paid items, waiver rate).
 *    It is arithmetic on the bank's figures with every assumption stated, never a forecast.
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
    annualDelta: paid == null ? null : Math.round(perItem * paid * (1 - waiver)),
    evidence: paid == null ? "market" : "institution",
  };
}

export interface FeeIncomeAssumptionInput {
  feeName: string;
  /** Today's published price, or null when the bank has none (each change is then from $0). */
  current: number | null;
  /** Several published amounts for this fee, when the schedule lists more than one. */
  ownSeveral?: string | null;
  paidItems: number | null;
  waiverRate: number | null;
  /** Where the bank's figures came from: typed on the page or saved in My bank and data. */
  figuresFrom: "typed" | "saved";
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * Every assumption behind the fee income figure, in plain sentences (#1896). Empty when the bank
 * has not supplied its yearly volume, because then no fee income figure is shown at all.
 */
export function feeIncomeAssumptions(input: FeeIncomeAssumptionInput): string[] {
  const paid = input.paidItems != null && input.paidItems > 0 ? input.paidItems : null;
  if (paid == null) return [];
  const fee = input.feeName.toLowerCase();
  const where = input.figuresFrom === "saved" ? "saved in My bank and data" : "entered on this page";
  const waiver = input.waiverRate != null ? Math.min(Math.max(input.waiverRate, 0), 1) : null;
  return [
    input.current != null
      ? `Starting price: ${money(input.current)}, your published ${fee} fee.`
      : input.ownSeveral
        ? `Starting price: $0, because your schedule lists several ${fee} fees (${input.ownSeveral}).`
        : `Starting price: $0, because no ${fee} fee is published for you.`,
    `Items charged a year: ${paid.toLocaleString("en-US")}, before waivers, your figure ${where}.`,
    waiver != null
      ? `Share waived or refunded: ${Math.round(waiver * 1000) / 10}%, your figure ${where}.`
      : "Share waived or refunded: none, because no share was entered.",
    "The same number of items is charged at every price tested. How customers respond to a price change is not estimated.",
    "The waived or refunded share stays the same at every price tested.",
    "Calculation: change per item, times items charged a year, times the share not waived. The result is a yearly change in fee income before tax and before any other cost.",
    "This is arithmetic on your own figures, not a prediction of fee income.",
  ];
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
