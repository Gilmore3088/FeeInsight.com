import type { FeeCategorySummary } from "@/lib/data-store";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { lowerName, type Finding } from "@/lib/research-report/finding";

export { lowerName, type Finding };

/** What each institution's one value is for a fee, as /fees words it: the median of its prices, or the highest for overdraft. */
export function institutionValues(category: string): string {
  return HIGHEST_TIER_CATEGORIES.has(category) ? "institutions' highest published prices" : "institution medians";
}

/**
 * A share of institutions as a whole percent. A share that rounds to 0% but has institutions behind
 * it reads "<1%", so a card never says 0% beside a count of two or three.
 */
export function shareLabel(count: number, total: number): string {
  if (total <= 0 || count <= 0) return "0%";
  const pct = (count / total) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** Fee names as they read inside a sentence ("Credit union ___ fees are..."). */
const SENTENCE_NAMES: Record<string, string> = {
  overdraft: "overdraft",
  nsf: "NSF",
  monthly_maintenance: "monthly maintenance",
  atm_non_network: "out-of-network ATM",
  wire_domestic_outgoing: "outgoing domestic wire",
  wire_intl_outgoing: "outgoing international wire",
  stop_payment: "stop payment",
  cashiers_check: "cashier's check",
};

export function sentenceName(category: string): string {
  return SENTENCE_NAMES[category] ?? lowerName(category);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Whole dollars read "$5"; anything with cents keeps them ("$2.50"). */
export function money(value: number | null | undefined): string {
  if (value == null) return "-";
  return Number.isInteger(value) ? `$${formatCount(value)}` : formatAmount(value);
}

/**
 * The findings section's one line: on how many of the compared fees credit unions have the lower
 * median. Null when no fee has both a bank and a credit union median.
 */
export function charterCountLine(benchmarks: FeeCategorySummary[]): string | null {
  const paired = benchmarks.filter((b) => b.bank_median_amount != null && b.cu_median_amount != null && b.bank_median_amount > 0);
  if (paired.length === 0) return null;
  const cuLower = paired.filter((b) => b.cu_median_amount! < b.bank_median_amount!).length;
  const bankLower = paired.filter((b) => b.bank_median_amount! < b.cu_median_amount!).length;
  const of = `${paired.length} everyday ${paired.length === 1 ? "fee" : "fees"} compared`;
  if (cuLower === 0 && bankLower === 0) return `Banks and credit unions have the same median on all ${of}.`;
  return cuLower >= bankLower
    ? `Credit unions have the lower median on ${cuLower} of the ${of}.`
    : `Banks have the lower median on ${bankLower} of the ${of}.`;
}

/**
 * Findings computed from the benchmark summaries. Each one leads with a plain statement, adds one
 * supporting sentence, and keeps the calculation in `about`. A finding appears only when the data
 * behind it clears the statistics contract (medians are null below the minimum sample).
 */
export function computeFindings(benchmarks: FeeCategorySummary[]): Finding[] {
  const findings: Finding[] = [];
  const n = benchmarks.length;

  const paired = benchmarks.filter(
    (b) => b.bank_median_amount != null && b.cu_median_amount != null && b.bank_median_amount > 0,
  );
  if (paired.length > 0) {
    const widest = [...paired].sort(
      (a, b) => Math.abs(b.bank_median_amount! - b.cu_median_amount!) - Math.abs(a.bank_median_amount! - a.cu_median_amount!),
    )[0];
    const gap = widest.bank_median_amount! - widest.cu_median_amount!;
    if (gap !== 0) {
      const lower = gap > 0 ? "Credit union" : "Bank";
      findings.push({
        key: "charter-gap",
        figure: money(Math.abs(gap)),
        headline: `${lower} ${sentenceName(widest.fee_category)} fees are ${money(Math.abs(gap))} lower at the median.`,
        detail: `The median is ${money(widest.cu_median_amount)} at credit unions and ${money(widest.bank_median_amount)} at banks.`,
        about: `Each institution counts once, at the median of its published prices for the fee (overdraft: its highest). The figure is the median of those values among ${formatCount(widest.cu_count)} credit unions, set against the same among ${formatCount(widest.bank_count)} banks. It compares published prices, not what customers end up paying.`,
        exhibit: "benchmarks",
        fee_category: widest.fee_category,
      });
    }
  }

  const overdraft = benchmarks.find((b) => b.fee_category === "overdraft");
  if (overdraft?.median_amount != null) {
    findings.push({
      key: "overdraft",
      figure: money(overdraft.median_amount),
      headline: `The median overdraft fee is ${money(overdraft.median_amount)}.`,
      detail: `The middle 50% of the ${formatCount(overdraft.institution_count)} banks and credit unions with a published overdraft fee fall between ${money(overdraft.p25_amount)} and ${money(overdraft.p75_amount)}.`,
      about: "Many schedules list more than one overdraft price, so each institution counts once, at its highest published overdraft price. The range is the 25th to 75th percentile of those prices.",
      exhibit: "benchmarks",
      fee_category: "overdraft",
    });
  }

  const spread = benchmarks
    .filter((b) => b.p25_amount != null && b.p75_amount != null && b.p25_amount > 0)
    .sort((a, b) => b.p75_amount! / b.p25_amount! - a.p75_amount! / a.p25_amount!)[0];
  if (spread && spread.p75_amount! / spread.p25_amount! >= 1.5) {
    const ratio = (spread.p75_amount! / spread.p25_amount!).toFixed(1);
    findings.push({
      key: "spread",
      figure: `${ratio}×`,
      headline: `${capitalize(sentenceName(spread.fee_category))} fees vary the most of these ${n} fees.`,
      detail: `A quarter of institutions list ${money(spread.p25_amount)} or less, and a quarter list ${money(spread.p75_amount)} or more.`,
      about: `The 75th percentile of ${institutionValues(spread.fee_category)} is ${ratio} times the 25th, the largest ratio among the ${n} benchmark fees. How often customers pay the fee isn't measured here.`,
      exhibit: "benchmarks",
      fee_category: spread.fee_category,
    });
  }

  const free = benchmarks
    .filter((b) => b.institution_count > 0 && b.zero_count > 0)
    .sort((a, b) => b.zero_count / b.institution_count - a.zero_count / a.institution_count)[0];
  // zero_count counts an institution only when every price it publishes for the fee is $0.
  if (free && free.zero_count / free.institution_count >= 0.01) {
    const share = shareLabel(free.zero_count, free.institution_count);
    findings.push({
      key: "free",
      figure: share,
      headline: `${share} of institutions publish only $0 ${sentenceName(free.fee_category)} prices.`,
      detail: `That is ${formatCount(free.zero_count)} of ${formatCount(free.institution_count)} institutions, the highest share among these ${n} fees.`,
      about: `An institution is counted only when every ${sentenceName(free.fee_category)} price it publishes is $0. One with a free account and a paid account isn't counted.`,
      exhibit: "benchmarks",
      fee_category: free.fee_category,
    });
  }

  return findings;
}
