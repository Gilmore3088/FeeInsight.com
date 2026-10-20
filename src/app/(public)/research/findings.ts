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

/** Where a finding's evidence sits: the fee's own page, or the benchmark table for a cross-fee finding. */
export function evidenceHref(f: Pick<Finding, "fee_category" | "exhibit">): string {
  return f.fee_category ? `/fees/${f.fee_category}` : `#${f.exhibit}`;
}

/**
 * Findings computed from the benchmark summaries, broadest first: banks against credit unions
 * across every compared fee, the widest single bank and credit union gap, the widest spread,
 * then the largest share of institutions whose observed prices are all $0. Each one leads with
 * a plain statement, adds one supporting sentence, and keeps the calculation in `about`. A
 * finding appears only when the data behind it clears the statistics contract (medians are
 * null below the minimum sample); the hub shows the first three.
 */
export function computeFindings(benchmarks: FeeCategorySummary[]): Finding[] {
  const findings: Finding[] = [];
  const n = benchmarks.length;

  const paired = benchmarks.filter(
    (b) => b.bank_median_amount != null && b.cu_median_amount != null && b.bank_median_amount > 0,
  );
  if (paired.length >= 2) {
    const cuLower = paired.filter((b) => b.cu_median_amount! < b.bank_median_amount!);
    const bankLower = paired.filter((b) => b.bank_median_amount! < b.cu_median_amount!);
    const equal = paired.length - cuLower.length - bankLower.length;
    const names = (list: FeeCategorySummary[]) => list.map((b) => sentenceName(b.fee_category)).join(", ");
    const matchPart = equal > 0 ? [`the medians match on ${equal}`] : [];
    const about = `Each institution counts once per fee, at the median of its published prices (overdraft: its highest). Bank and credit union medians are taken separately for every fee where both groups have enough institutions for a median, then compared fee by fee. It compares published prices, not what customers end up paying.`;
    if (cuLower.length > 0 && cuLower.length === bankLower.length) {
      // A tie names neither side as lower overall.
      findings.push({
        key: "charter-count",
        figure: `${cuLower.length} and ${bankLower.length}`,
        headline: `Banks and credit unions each have the lower median on ${cuLower.length} of ${paired.length} everyday fees.`,
        detail: [`Lower at credit unions: ${names(cuLower)}`, `lower at banks: ${names(bankLower)}`, ...matchPart].join("; ") + ".",
        about,
        exhibit: "benchmarks",
      });
    } else if (cuLower.length + bankLower.length > 0) {
      const cuLeads = cuLower.length > bankLower.length;
      const lead = cuLeads ? cuLower : bankLower;
      const rest = [`${cuLeads ? "Banks" : "Credit unions"} are lower on ${cuLeads ? bankLower.length : cuLower.length}`, ...matchPart];
      findings.push({
        key: "charter-count",
        figure: `${lead.length} of ${paired.length}`,
        headline: `${cuLeads ? "Credit unions" : "Banks"} have the lower median on ${lead.length} of ${paired.length} everyday fees.`,
        detail: `${rest.join("; ")}. Lower at ${cuLeads ? "credit unions" : "banks"}: ${names(lead)}.`,
        about,
        exhibit: "benchmarks",
      });
    }
  }

  if (paired.length > 0) {
    const widest = [...paired].sort(
      (a, b) => Math.abs(b.bank_median_amount! - b.cu_median_amount!) - Math.abs(a.bank_median_amount! - a.cu_median_amount!),
    )[0];
    // Ranked by the dollar gap, so the copy says "in dollars".
    const gap = widest.bank_median_amount! - widest.cu_median_amount!;
    if (gap !== 0) {
      const lower = gap > 0 ? "Credit union" : "Bank";
      findings.push({
        key: "charter-gap",
        figure: money(Math.abs(gap)),
        headline: `${lower} ${sentenceName(widest.fee_category)} fees are ${money(Math.abs(gap))} lower at the median.`,
        detail: `The median is ${money(widest.cu_median_amount)} at ${formatCount(widest.cu_count)} credit unions and ${money(widest.bank_median_amount)} at ${formatCount(widest.bank_count)} banks, the widest gap in dollars of the fees compared.`,
        about: `Each institution counts once, at the median of its published prices for the fee (overdraft: its highest). The figure is the median of those values among ${formatCount(widest.cu_count)} credit unions, set against the same among ${formatCount(widest.bank_count)} banks. It compares published prices, not what customers end up paying.`,
        exhibit: "benchmarks",
        fee_category: widest.fee_category,
      });
    }
  }

  // The ratio needs a 25th percentile above $0, so fees whose 25th percentile is $0 are left out and the copy counts only the rest.
  const ratioFees = benchmarks.filter((b) => b.p25_amount != null && b.p75_amount != null && b.p25_amount > 0);
  const leftOut = n - ratioFees.length;
  const spread = [...ratioFees].sort((a, b) => b.p75_amount! / b.p25_amount! - a.p75_amount! / a.p25_amount!)[0];
  if (spread && ratioFees.length >= 2 && spread.p75_amount! / spread.p25_amount! >= 1.5) {
    const ratio = (spread.p75_amount! / spread.p25_amount!).toFixed(1);
    findings.push({
      key: "spread",
      figure: `${ratio}×`,
      headline: `${capitalize(sentenceName(spread.fee_category))} prices vary the most of ${ratioFees.length} everyday fees compared.`,
      detail: `The middle 50% of ${formatCount(spread.institution_count)} institutions runs from ${money(spread.p25_amount)} to ${money(spread.p75_amount)}. The 75th percentile is ${ratio} times the 25th.`,
      about: `Spread is measured as the 75th percentile of ${institutionValues(spread.fee_category)} divided by the 25th, so fees with different price levels compare fairly. A fee with a wider dollar range can rank lower if its prices are higher overall. How often customers pay the fee isn't measured here.${leftOut > 0 ? ` ${leftOut === 1 ? "One fee is" : `${leftOut} fees are`} left out because ${leftOut === 1 ? "its" : "their"} 25th percentile is $0.` : ""}`,
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
      headline: `At ${share} of institutions, all observed ${sentenceName(free.fee_category)} prices are $0.`,
      detail: `That is ${formatCount(free.zero_count)} of ${formatCount(free.institution_count)} institutions, the highest share among these ${n} fees.`,
      about: `${ZERO_PRICE_CAVEAT} An institution with a free account and a paid account isn't counted.`,
      exhibit: "benchmarks",
      fee_category: free.fee_category,
    });
  }

  return findings;
}

/** What "all observed prices are $0" can and can't establish, said wherever the share appears. */
export const ZERO_PRICE_CAVEAT =
  "Counted only when every price we found for the fee on the institution's schedule is $0. Which account each price belongs to isn't checked yet, so this doesn't show every account is free.";
