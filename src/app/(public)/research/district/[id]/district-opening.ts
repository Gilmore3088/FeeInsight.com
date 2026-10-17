import type { IndexEntry, StateFeeIndexes } from "@/lib/data-store";
import {
  STATE_FINDING_MIN_INSTITUTIONS,
  buildComparisons,
  nationalBandTakeaway,
  type StateComparison,
} from "@/lib/research-report/state-findings";
import { boardFees, splitForAccess, type BoardFee } from "../../state/[code]/state-view";
import { nationalGap, openingFinding } from "./district-hub-view";

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

export function districtOpening(
  indexes: Pick<StateFeeIndexes, "all" | "bank" | "credit_union" | "institution_values">,
  nationalIndex: IndexEntry[],
  showAllCategories: boolean,
  place: string,
): DistrictOpening {
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  const againstUs = shown.filter((f) => f.us);
  const takeaway = nationalBandTakeaway(place, `the ${place}`, visibleComparisons);
  // The opening takeaway is the district's sharpest specific gap; the band count sits beside it as context.
  const statement = openingFinding(againstUs, STATE_FINDING_MIN_INSTITUTIONS) ?? takeaway;
  return { comparisons, fees, shown, locked, visibleComparisons, againstUs, statement };
}

/**
 * Where the district's overdraft median sits against the national median, by the opening
 * finding's rule (within 1% reads as about the same). Null when the district has fewer than
 * the finding minimum of institutions publishing an overdraft fee.
 */
export function overdraftSide(opening: Pick<DistrictOpening, "againstUs">): "above" | "below" | "same" | null {
  const od = opening.againstUs.find((f) => f.key === "overdraft");
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
