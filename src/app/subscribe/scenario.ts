import { formatAmount } from "@/lib/format";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";

/** A Try a price question worked from the live national index (built on the server). */
export interface AnalyzeScenario {
  feeLabel: string;
  price: number;
  median: number;
  p25: number | null;
  p75: number | null;
  institutions: number;
}

/**
 * The example question: a price a few dollars under the live national median. Null when the
 * benchmark has too few institutions for a median. Shared by /subscribe and /for-institutions.
 */
export function buildScenario(
  feeLabel: string,
  entry: { median_amount: number | null; p25_amount: number | null; p75_amount: number | null; institution_count: number } | null | undefined,
): AnalyzeScenario | null {
  if (!entry || entry.median_amount === null || entry.institution_count < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  const median = Number(entry.median_amount);
  if (!(median > 0)) return null;
  const price = median >= 10 ? Math.round(median) - 5 : Math.round(median * 80) / 100;
  return {
    feeLabel,
    price,
    median,
    p25: entry.p25_amount === null ? null : Number(entry.p25_amount),
    p75: entry.p75_amount === null ? null : Number(entry.p75_amount),
    institutions: entry.institution_count,
  };
}

export function scenarioQuestion(s: AnalyzeScenario): string {
  return `Where would a ${formatAmount(s.price)} ${s.feeLabel.toLowerCase()} fee sit nationally?`;
}

/** Where the price sits, in plain words. Describes the market; never advises a price. */
export function scenarioAnswer(s: AnalyzeScenario): string {
  const vsMedian = s.price < s.median ? "below" : s.price > s.median ? "above" : "at";
  const range = s.p25 !== null && s.p75 !== null ? ` (${formatAmount(s.p25)}–${formatAmount(s.p75)})` : "";
  let band = "";
  if (s.p25 !== null && s.p75 !== null) {
    if (s.price < s.p25) band = `, below the middle half of the market${range}`;
    else if (s.price > s.p75) band = `, above the middle half of the market${range}`;
    else band = `, inside the middle half of the market${range}`;
  }
  const median = vsMedian === "at" ? "at" : `${vsMedian} the`;
  return `A ${formatAmount(s.price)} ${s.feeLabel.toLowerCase()} fee would sit ${median} national median of ${formatAmount(
    s.median,
  )}${band}, across ${s.institutions.toLocaleString("en-US")} institutions.`;
}

export function scenarioPct(amount: number, max: number): string {
  return `${Math.max(0, Math.min(100, (amount / max) * 100)).toFixed(1)}%`;
}

export function scenarioMax(s: AnalyzeScenario): number {
  return Math.max(s.p75 ?? s.median, s.price, s.median) * 1.25 || 1;
}
