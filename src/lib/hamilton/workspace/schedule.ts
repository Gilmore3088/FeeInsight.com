/**
 * Whole-schedule questions ("Where do we stand on every fee?"): the bank's published fees
 * against their peer medians, furthest from the median first. The engine answers these
 * outright; the detailed answer below the overview is the fee furthest from its median.
 */

import { formatFeeAmount } from "@/lib/format";
import type { Fact, FeePositionRow, SourceRef } from "./types";

const WHOLE_SCHEDULE =
  /\b(?:every|all(?: of)?(?: our| my| the)?|each|whole|entire|overall)\b[^.?!]{0,30}\bfees?\b|\bfee schedule\b|\b(?:all|every) (?:our|my) (?:prices|pricing)\b/i;

const FEES_SOURCE: SourceRef = {
  label: "Fees on each institution's own published schedule (verified, live)",
  table: "published_fee_catalog",
};

/** True when the question is about the bank's fees as a whole, not one fee. */
export function asksWholeSchedule(question: string): boolean {
  return WHOLE_SCHEDULE.test(question);
}

export interface ScheduleOverview {
  /** The fee furthest from its peer median, answered in detail; null when none compares. */
  top: string | null;
  shortAnswer: string;
  facts: Fact[];
}

const money = (n: number): string => formatFeeAmount(n) ?? `$${n}`;

type Ranked = FeePositionRow & { band: NonNullable<FeePositionRow["band"]>; gap: number };

function gapOf(row: Ranked): number {
  return row.band.median > 0 ? (row.current - row.band.median) / row.band.median : row.current - row.band.median;
}

/** "your $36 is $6 higher than the median of 14 peers ($30)" */
function position(row: Ranked): string {
  const diff = Math.round((row.current - row.band.median) * 100) / 100;
  const peers = `the median of ${row.band.n} peers (${money(row.band.median)})`;
  if (Math.abs(diff) < 0.005) return `your ${money(row.current)} is at ${peers}`;
  return `your ${money(row.current)} is ${money(Math.abs(diff))} ${diff > 0 ? "higher" : "lower"} than ${peers}`;
}

function lineFor(row: Ranked): string {
  return `${row.displayName}: ${position(row)}.`;
}

/** The overview: counts above, below and at the median, then each fee, furthest first. */
export function scheduleOverview(rows: readonly FeePositionRow[]): ScheduleOverview {
  const ranked: Ranked[] = rows
    .filter((r): r is FeePositionRow & { band: NonNullable<FeePositionRow["band"]> } => r.band !== null)
    .map((r) => ({ ...r, gap: gapOf({ ...r, gap: 0 }) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.displayName.localeCompare(b.displayName));
  if (ranked.length === 0) {
    return {
      top: null,
      shortAnswer: `Hamilton has ${rows.length} of your published fees on file; none yet has enough peers publishing it to compare.`,
      facts: [],
    };
  }
  const higher = ranked.filter((r) => r.current - r.band.median >= 0.005).length;
  const lower = ranked.filter((r) => r.band.median - r.current >= 0.005).length;
  const at = ranked.length - higher - lower;
  const counts = [`${higher} sit higher than the peer median`, `${lower} lower`, ...(at > 0 ? [`${at} at it`] : [])];
  const first = ranked[0];
  const thin = rows.length - ranked.length;
  const shortAnswer =
    `Of your ${ranked.length} fees with a peer comparison, ${counts.join(", ")}. ` +
    `Furthest from its median is ${first.displayName}: ${position(first)}.` +
    (thin > 0 ? ` ${thin} more ${thin === 1 ? "fee has" : "fees have"} too few peers publishing to compare.` : "");
  return {
    top: first.feeCategory,
    shortAnswer,
    facts: ranked.map((r) => ({ text: lineFor(r), source: FEES_SOURCE, sampleSize: r.band.n })),
  };
}
