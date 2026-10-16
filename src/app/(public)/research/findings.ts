import type { FeeCategorySummary } from "@/lib/data-store";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { getDisplayName } from "@/lib/fee-taxonomy";
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

/**
 * Executive-summary findings computed from the benchmark summaries. Each finding is
 * produced only when the data behind it clears the statistics contract (medians are
 * already null below the minimum sample), so a thin category never headlines.
 */
export function computeFindings(benchmarks: FeeCategorySummary[]): Finding[] {
  const findings: Finding[] = [];

  const overdraft = benchmarks.find((b) => b.fee_category === "overdraft");
  if (overdraft?.median_amount != null) {
    findings.push({
      key: "overdraft",
      figure: formatAmount(overdraft.median_amount),
      headline: "Median overdraft fee",
      detail: `Across ${formatCount(overdraft.institution_count)} banks and credit unions, each counted at its highest published overdraft price. The middle half of those prices run ${formatAmount(overdraft.p25_amount)} to ${formatAmount(overdraft.p75_amount)}.`,
      exhibit: "benchmarks",
    });
  }

  const paired = benchmarks.filter(
    (b) => b.bank_median_amount != null && b.cu_median_amount != null && b.bank_median_amount > 0,
  );
  if (paired.length > 0) {
    const cuCheaper = paired.filter((b) => b.cu_median_amount! < b.bank_median_amount!);
    const widest = [...paired].sort(
      (a, b) => Math.abs(b.bank_median_amount! - b.cu_median_amount!) - Math.abs(a.bank_median_amount! - a.cu_median_amount!),
    )[0];
    const gap = widest.bank_median_amount! - widest.cu_median_amount!;
    if (gap !== 0) {
      const lower = gap > 0 ? "credit union" : "bank";
      findings.push({
        key: "charter-gap",
        figure: formatAmount(Math.abs(gap)),
        headline: `Lower ${lower} median for ${lowerName(widest.fee_category)}`,
        detail: `Median ${formatAmount(widest.cu_median_amount)} at credit unions vs ${formatAmount(widest.bank_median_amount)} at banks. Credit unions are lower on ${cuCheaper.length} of ${paired.length} everyday fees compared.`,
        exhibit: "charters",
      });
    }
  }

  const spread = benchmarks
    .filter((b) => b.p25_amount != null && b.p75_amount != null && b.p25_amount > 0)
    .sort((a, b) => b.p75_amount! / b.p25_amount! - a.p75_amount! / a.p25_amount!)[0];
  if (spread && spread.p75_amount! / spread.p25_amount! >= 1.5) {
    findings.push({
      key: "spread",
      figure: `${(spread.p75_amount! / spread.p25_amount!).toFixed(1)}×`,
      headline: `${getDisplayName(spread.fee_category)}: largest relative spread among these ${benchmarks.length} fees`,
      detail: `The 75th percentile of ${institutionValues(spread.fee_category)} (${formatAmount(spread.p75_amount)}) is ${(spread.p75_amount! / spread.p25_amount!).toFixed(1)} times the 25th (${formatAmount(spread.p25_amount)}), a gap of ${formatAmount(spread.p75_amount! - spread.p25_amount!)}. How often the fee is paid isn't measured here.`,
      exhibit: "benchmarks",
    });
  }

  const free = benchmarks
    .filter((b) => b.institution_count > 0 && b.zero_count > 0)
    .sort((a, b) => b.zero_count / b.institution_count - a.zero_count / a.institution_count)[0];
  if (free) {
    // zero_count counts an institution only when every price it publishes for the fee is $0.
    if (free.zero_count / free.institution_count >= 0.01) {
      findings.push({
        key: "free",
        figure: shareLabel(free.zero_count, free.institution_count),
        headline: `of institutions publish only $0 ${lowerName(free.fee_category)} prices`,
        detail: `For ${formatCount(free.zero_count)} of ${formatCount(free.institution_count)} institutions, every ${lowerName(free.fee_category)} price they publish is $0. An institution with one free account and one paid account isn't counted. That is the highest share among these ${benchmarks.length} fees.`,
        exhibit: "benchmarks",
      });
    }
  }

  return findings;
}
