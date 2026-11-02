import { findZeroWaiverRows, type ZeroWaiverRowLiveRow, type ZeroWaiverRowMatch } from "@/lib/agents/darwin/zero-waiver-row-check";
import type { ZeroWaiverRowKind } from "@/lib/zero-waiver-row";

/**
 * `ZERO_WAIVER_ROW_TAKEDOWN_LIVE` (#1092): the live $0 fees Darwin's waiver-row re-check would take
 * down switched on, judged by the re-check's own function (`findZeroWaiverRows`: Knox's stored line
 * and the line `checkFeeAgainstSource` traces the fee to, on the text Knox read). Pure: the reader
 * brings the rows and texts.
 */

export interface ZeroWaiverRowSummary {
  /** Live $0 fees the re-check's SQL selected. */
  checked: number;
  /** Selected fees whose text is gone: not judged. */
  noText: number;
  /** Fees the switch would take down (each after its 12-hour second look). */
  wouldTakeDown: number;
  institutions: number;
  byKind: Record<ZeroWaiverRowKind, number>;
  byCategory: Record<string, number>;
  samples: ZeroWaiverRowMatch[];
}

export function emptyZeroWaiverRowSummary(): ZeroWaiverRowSummary {
  return { checked: 0, noText: 0, wouldTakeDown: 0, institutions: 0, byKind: { no_fee_sentence: 0, waiver_requirement: 0, avoid_fee_advice: 0 }, byCategory: {}, samples: [] };
}

/** Adds one chunk of rows, judged on their texts, to the summary. Institutions are counted at the end. */
export function addZeroWaiverRows(
  summary: ZeroWaiverRowSummary,
  institutions: Set<number>,
  rows: readonly ZeroWaiverRowLiveRow[],
  texts: ReadonlyMap<number, string>,
  sampleCap: number,
): void {
  const found = findZeroWaiverRows(rows, texts);
  summary.checked += found.checked;
  summary.noText += found.noText;
  summary.wouldTakeDown += found.matched;
  for (const fee of found.matches) {
    institutions.add(fee.institutionId);
    summary.byKind[fee.kind] += 1;
    const key = fee.canonicalFeeKey ?? "none";
    summary.byCategory[key] = (summary.byCategory[key] ?? 0) + 1;
    if (summary.samples.length < sampleCap) summary.samples.push(fee);
  }
  summary.institutions = institutions.size;
}
