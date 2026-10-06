/**
 * Everything the State Index report shows, computed from the same reads and helpers as the
 * public state report (/research/state/[code]). Pure: the caller does the reads (see
 * load-state-report.ts), so the web page, the PDF and the tests share one computation.
 */
import type { IndexEntry, StateFeeIndexes } from "@/lib/data-store";
import { isFeaturedFee } from "@/lib/fee-taxonomy";
import { BENCHMARK_KEYS } from "./benchmark-keys";
import type { Finding } from "./finding";
import {
  buildCharterPairs,
  buildComparisons,
  computeStateFindings,
  type CharterPair,
  type StateComparison,
} from "./state-findings";

export interface StateReportData {
  stateCode: string;
  stateName: string;
  /** Federal Reserve district number, when the state maps to one. */
  district: number | null;
  /** Date the public catalog was last refreshed ("Oct 5, 2026"), or null when unknown. */
  asOf: string | null;
  /** Institutions headquartered in the state that the index monitors. */
  monitored: { institutions: number; banks: number; credit_unions: number };
  /** Institutions and fee rows that count toward the statistics (published_fee_catalog). */
  verified: { institutions: number; banks: number; credit_unions: number; fees: number };
  /** Every shown category with a state median, joined to the national index. */
  comparisons: StateComparison[];
  /** The everyday fees (BENCHMARK_KEYS order) that have a state median. */
  everyday: StateComparison[];
  /** Bank and credit union medians, only where both charters have one. */
  charterPairs: CharterPair[];
  findings: Finding[];
  /** Categories with a state median left out because they are not featured fees. */
  hiddenCategoryCount: number;
}

export interface StateReportInputs {
  stateCode: string;
  stateName: string;
  district: number | null;
  asOf: string | null;
  stats: { institution_count: number; bank_count: number; cu_count: number };
  indexes: StateFeeIndexes;
  national: IndexEntry[];
  /** Pro view: every category. The public report shows featured fees only. */
  includeAllCategories?: boolean;
}

export function buildStateReportData(input: StateReportInputs): StateReportData {
  const { indexes } = input;
  const comparisons = buildComparisons(indexes.all, input.national);
  const visible = input.includeAllCategories ? comparisons : comparisons.filter((c) => isFeaturedFee(c.fee_category));
  const everyday = BENCHMARK_KEYS.map((k) => comparisons.find((c) => c.fee_category === k)).filter(
    (c): c is StateComparison => !!c,
  );
  const charterPairs = buildCharterPairs(
    indexes.bank,
    indexes.credit_union,
    visible.map((c) => c.fee_category),
  );
  return {
    stateCode: input.stateCode,
    stateName: input.stateName,
    district: input.district,
    asOf: input.asOf,
    monitored: {
      institutions: input.stats.institution_count,
      banks: input.stats.bank_count,
      credit_unions: input.stats.cu_count,
    },
    verified: {
      institutions: indexes.verified_institutions,
      banks: indexes.verified_bank_institutions,
      credit_unions: indexes.verified_cu_institutions,
      fees: indexes.verified_fees,
    },
    comparisons: visible,
    everyday,
    charterPairs,
    findings: computeStateFindings(input.stateName, visible, charterPairs),
    hiddenCategoryCount: comparisons.length - visible.length,
  };
}
