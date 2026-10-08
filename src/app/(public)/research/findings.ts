import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { lowerName, type Finding } from "@/lib/research-report/finding";

export { lowerName, type Finding };

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
      headline: "The typical overdraft fee",
      detail: `Median across ${formatCount(overdraft.institution_count)} banks and credit unions; the middle half charge ${formatAmount(overdraft.p25_amount)} to ${formatAmount(overdraft.p75_amount)}.`,
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
      const cheaper = gap > 0 ? "Credit unions" : "Banks";
      findings.push({
        key: "charter-gap",
        figure: formatAmount(Math.abs(gap)),
        headline: `${cheaper} charge less for ${lowerName(widest.fee_category)}`,
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
      headline: `${getDisplayName(spread.fee_category)} prices vary the most`,
      detail: `The 75th-percentile price (${formatAmount(spread.p75_amount)}) is ${(spread.p75_amount! / spread.p25_amount!).toFixed(1)} times the 25th (${formatAmount(spread.p25_amount)}). Where you bank matters most here.`,
      exhibit: "benchmarks",
    });
  }

  const free = benchmarks
    .filter((b) => b.institution_count > 0 && b.zero_count > 0)
    .sort((a, b) => b.zero_count / b.institution_count - a.zero_count / a.institution_count)[0];
  if (free) {
    const share = Math.round((free.zero_count / free.institution_count) * 100);
    if (share >= 1) {
      findings.push({
        key: "free",
        figure: `${share}%`,
        headline: `of institutions list ${lowerName(free.fee_category)} at $0`,
        detail: `${formatCount(free.zero_count)} of ${formatCount(free.institution_count)} institutions publish this fee as free, the highest share among everyday fees.`,
        exhibit: "benchmarks",
      });
    }
  }

  return findings;
}
