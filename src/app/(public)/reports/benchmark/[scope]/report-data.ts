/** Rows and findings of a free benchmark report (pure; the page does the reads). */
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { formatAmount } from "@/lib/format";
import type { Finding } from "../../../research/findings";
import {
  buildCharterPairs,
  buildComparisons,
  computeStateFindings,
  type CharterPair,
  type StateComparison,
} from "../../../research/state/[code]/state-findings";

/** A headline fee is shown only when at least this many institutions publish it. */
export const MIN_BENCHMARK_INSTITUTIONS = 20;

/** A charter median needs this many institutions before it is compared with the other charter. */
export const MIN_CHARTER_INSTITUTIONS = 10;

/**
 * Headline fees with enough institutions behind the median, in headline order. Pass the
 * national index as `national` for a district report and null for the national report.
 */
export function buildReportRows(entries: IndexEntry[], national: IndexEntry[] | null): StateComparison[] {
  const byCategory = new Map(buildComparisons(entries, national ?? []).map((c) => [c.fee_category, c]));
  return HEADLINE_FEE_KEYS.map((key) => byCategory.get(key)).filter(
    (c): c is StateComparison => !!c && c.institution_count >= MIN_BENCHMARK_INSTITUTIONS,
  );
}

/** Bank vs credit union medians for the report's fees, where each charter has enough institutions. */
export function buildReportCharterPairs(bank: IndexEntry[], cu: IndexEntry[], rows: StateComparison[]): CharterPair[] {
  const enough = (e: IndexEntry) => e.institution_count >= MIN_CHARTER_INSTITUTIONS;
  return buildCharterPairs(bank.filter(enough), cu.filter(enough), rows.map((r) => r.fee_category));
}

/** National findings: the two penalty fees, then the bank vs credit union gap. */
export function computeNationalFindings(rows: StateComparison[], charterPairs: CharterPair[]): Finding[] {
  const findings: Finding[] = [];
  for (const [key, headline] of [
    ["overdraft", "The typical overdraft fee"],
    ["nsf", "The typical NSF fee"],
  ] as const) {
    const row = rows.find((r) => r.fee_category === key);
    if (!row) continue;
    findings.push({
      key,
      figure: formatAmount(row.median_amount),
      headline,
      detail: `Median across ${row.institution_count.toLocaleString()} banks and credit unions; the middle half charge ${formatAmount(row.p25_amount)} to ${formatAmount(row.p75_amount)}.`,
      exhibit: "benchmarks",
    });
  }
  // The state findings' charter comparison reads the same for the whole country.
  return [...findings, ...computeStateFindings("the U.S.", [], charterPairs)];
}

/** District findings: the state findings, worded for "the St. Louis district". */
export function computeDistrictFindings(place: string, rows: StateComparison[], charterPairs: CharterPair[]): Finding[] {
  return computeStateFindings(place, rows, charterPairs).map((f) => ({
    ...f,
    detail: f.detail.replace(`In ${place},`, `In the ${place},`),
  }));
}
