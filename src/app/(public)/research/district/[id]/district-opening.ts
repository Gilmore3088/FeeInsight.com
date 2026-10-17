import type { IndexEntry, StateFeeIndexes } from "@/lib/data-store";
import {
  STATE_FINDING_MIN_INSTITUTIONS,
  buildComparisons,
  nationalBandTakeaway,
  type StateComparison,
} from "@/lib/research-report/state-findings";
import { boardFees, splitForAccess, type BoardFee } from "../../state/[code]/state-view";
import { formatFeeAmount } from "@/lib/format";
import { sentenceName } from "../../findings";
import { nationalGap, openingFinding, type OpeningFee } from "./district-hub-view";

/**
 * The district's fees against the U.S. and its one-line opening finding, shaped once so the
 * district page and the research hub's districts exhibit print the same sentence from the
 * same index. Pure: the caller reads the district index and the national index.
 */
export interface DistrictOpening {
  comparisons: StateComparison[];
  /** Every fee the district has a median for, in board order. */
  fees: BoardFee[];
  /** The fees this reader may see, and the ones locked for free visitors. */
  shown: BoardFee[];
  locked: BoardFee[];
  visibleComparisons: StateComparison[];
  /** Shown fees that have a national band to compare with. */
  againstUs: BoardFee[];
  /** The district's opening sentence, or null when nothing clears the sample minimum. */
  statement: string | null;
}

export interface DistrictOpeningOptions {
  /**
   * "page" (default): the district page's opening, overdraft and NSF first. "strongest": the
   * research hub's card line, the fee furthest from the national median relative to it.
   */
  lead?: "page" | "strongest";
}

export function districtOpening(
  indexes: Pick<StateFeeIndexes, "all" | "bank" | "credit_union" | "institution_values">,
  nationalIndex: IndexEntry[],
  showAllCategories: boolean,
  place: string,
  options: DistrictOpeningOptions = {},
): DistrictOpening {
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  const againstUs = shown.filter((f) => f.us);
  const takeaway = nationalBandTakeaway(place, `the ${place}`, visibleComparisons);
  // The opening takeaway is the district's sharpest specific gap; the band count sits beside it as context.
  const statement =
    options.lead === "strongest"
      ? strongestDifference(againstUs, STATE_FINDING_MIN_INSTITUTIONS)
      : (openingFinding(againstUs, STATE_FINDING_MIN_INSTITUTIONS) ?? takeaway);
  return { comparisons, fees, shown, locked, visibleComparisons, againstUs, statement };
}

/**
 * The district's strongest supported difference: among fees with at least `minInstitutions`
 * district institutions and a national median, the one whose gap is the largest share of the
 * national median. Gaps within 1% read as about the same (nationalGap). Says so once when no fee
 * differs; null when no fee has enough institutions to compare.
 */
export function strongestDifference(fees: OpeningFee[], minInstitutions: number): string | null {
  const solid = fees.filter((f) => f.us && f.us.median > 0 && f.institutions >= minInstitutions);
  if (solid.length === 0) return null;
  const share = (f: OpeningFee) => Math.abs(nationalGap(f)) / f.us!.median;
  const widest = solid.filter((f) => nationalGap(f) !== 0).sort((a, b) => share(b) - share(a))[0];
  if (!widest) {
    return solid.length === 1
      ? `The ${sentenceName(solid[0].key)} median is about the same as the national median.`
      : `${solid.length === 2 ? "Both" : `All ${solid.length}`} fees with enough data are within 1% of the national median.`;
  }
  const pct = Math.round(share(widest) * 100);
  const side = nationalGap(widest) > 0 ? "above" : "below";
  return `The ${sentenceName(widest.key)} median, ${formatFeeAmount(widest.median)}, is ${pct}% ${side} the national median of ${formatFeeAmount(widest.us!.median)}.`;
}

/**
 * Where the district's overdraft median sits against the national median, by the opening
 * finding's rule (within 1% reads as about the same). Null when the district has fewer than
 * the finding minimum of institutions publishing an overdraft fee.
 */
export function overdraftSide(opening: Pick<DistrictOpening, "againstUs">): "above" | "below" | "same" | null {
  return feeSide(opening, "overdraft");
}

/** The same rule for any fee: where the district's median sits against the national median. */
export function feeSide(opening: Pick<DistrictOpening, "againstUs">, key: string): "above" | "below" | "same" | null {
  const od = opening.againstUs.find((f) => f.key === key);
  if (!od?.us || od.us.median <= 0 || od.institutions < STATE_FINDING_MIN_INSTITUTIONS) return null;
  const gap = nationalGap({ key: od.key, median: od.median, institutions: od.institutions, us: od.us });
  return gap > 0 ? "above" : gap < 0 ? "below" : "same";
}

/** The districts section's finding: where each district's overdraft median sits against the U.S. */
export function districtsFinding(sides: ("above" | "below" | "same" | null)[], total = 12): string | null {
  const known = sides.filter((s) => s !== null);
  // Under half the districts comparable is too thin for a headline.
  if (known.length < Math.ceil(total / 2)) return null;
  const n = (side: string) => known.filter((s) => s === side).length;
  const [above, below, same] = [n("above"), n("below"), n("same")];
  const of = known.length === total ? `${known.length} districts` : `${known.length} districts with enough overdraft fees`;
  const parts = [`above the national median in ${above} of ${of}`];
  if (below > 0) parts.push(`below it in ${below}`);
  if (same > 0) parts.push(`about the same in ${same}`);
  const tail = parts.length > 1 ? `${parts.length > 2 ? "," : ""} and ${parts.pop()}` : "";
  return `The overdraft median is ${parts.join(", ")}${tail}.`;
}
