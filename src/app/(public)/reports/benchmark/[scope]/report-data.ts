/** Rows and findings of a free benchmark report (pure; the page does the reads). */
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { formatAmount } from "@/lib/format";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { Finding } from "../../../research/findings";
import {
  buildCharterPairs,
  buildComparisons,
  computeStateFindings,
  type CharterPair,
  type StateComparison,
} from "@/lib/research-report/state-findings";

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

/** A spread finding needs this many institutions behind the fee, so one small sample can't lead. */
export const SPREAD_MIN_INSTITUTIONS = 100;

/**
 * National findings, across fees first: the bank vs credit union gap, then the fee whose
 * middle half spreads widest around its median, then overdraft. Each says how many
 * institutions stand behind it, since every fee rests on a different set.
 */
export function computeNationalFindings(rows: StateComparison[], charterPairs: CharterPair[]): Finding[] {
  // The state findings' charter comparison reads the same for the whole country.
  const findings: Finding[] = computeStateFindings("the U.S.", [], charterPairs);

  // Each finding names a different fee: skip overdraft and NSF (their own finding) and the charter gap's fee.
  const named = new Set(["overdraft", "nsf", ...findings.map((f) => f.fee_category)]);
  const spread = rows
    .filter((r) => !named.has(r.fee_category))
    .filter((r) => r.institution_count >= SPREAD_MIN_INSTITUTIONS && r.p25_amount != null && r.p25_amount > 0 && r.p75_amount != null && r.median_amount > 0)
    .map((r) => ({ row: r, width: (r.p75_amount! - r.p25_amount!) / r.median_amount }))
    .sort((a, b) => b.width - a.width)[0];
  if (spread && spread.width > 0) {
    const r = spread.row;
    findings.push({
      key: "spread",
      figure: `${formatAmount(r.p25_amount)} to ${formatAmount(r.p75_amount)}`,
      headline: `${getDisplayName(r.fee_category)} varies most`,
      detail: `The middle half of the ${r.institution_count.toLocaleString()} institutions publishing it charge ${formatAmount(r.p25_amount)} to ${formatAmount(r.p75_amount)}, around a median of ${formatAmount(r.median_amount)}.`,
      exhibit: "benchmarks",
      fee_category: r.fee_category,
    });
  }

  const overdraft = rows.find((r) => r.fee_category === "overdraft");
  if (overdraft) {
    const nsf = rows.find((r) => r.fee_category === "nsf");
    findings.push({
      key: "overdraft",
      figure: formatAmount(overdraft.median_amount),
      headline: "The typical overdraft fee",
      detail: `Median across the ${overdraft.institution_count.toLocaleString()} institutions publishing one; the middle half charge ${formatAmount(overdraft.p25_amount)} to ${formatAmount(overdraft.p75_amount)}.${
        nsf ? ` The NSF median is ${formatAmount(nsf.median_amount)} across ${nsf.institution_count.toLocaleString()}.` : ""
      }`,
      exhibit: "benchmarks",
      fee_category: "overdraft",
    });
  }
  return findings;
}

/** District findings: the state findings, worded for "the St. Louis district". */
export function computeDistrictFindings(place: string, rows: StateComparison[], charterPairs: CharterPair[]): Finding[] {
  return computeStateFindings(place, rows, charterPairs).map((f) => ({
    ...f,
    detail: f.detail.replace(`In ${place},`, `In the ${place},`),
  }));
}
