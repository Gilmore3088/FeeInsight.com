import { wilsonRange } from "@/lib/agents/deming/accuracy-measure";
import type { FreshAuditResult } from "@/lib/agents/deming/fresh-audit";

/**
 * Live accuracy, read from the one existing read-only measure: Deming's fresh audit
 * (`fresh-audit.ts`, run by Atlas daily). It draws a sample of live dollar fees from
 * `published_fee_catalog`, ordered by `md5(id || UTC date)`, so on the same day it draws the
 * same fees as that day's receipt, and checks each against its institution's newest completed
 * stored texts: amount with `traceLiveFee` (the shared `checkFeeAgainstSource`), category with
 * `checkFeeCategory`. This module only restates its counts. Pure.
 *
 * What it is not: a check against the bank's current schedule. A stored copy can be stale, and the
 * same validators publish and audit (`ACCURACY.md`, `findings/2026-10-19-live-source-audit.md`).
 * The launch measure is James's weekly 50-institution live batch
 * (`docs/plans/weekly-live-fee-accuracy-plan.md`), which no query can replace.
 */

export const LIVE_ACCURACY_METHOD =
  "Deming's fresh audit (fresh-audit.ts), read-only: a seeded sample of live dollar fees from published_fee_catalog " +
  "(md5(id || UTC date), the same draw as today's daily receipt), each checked against its institution's newest " +
  "completed stored texts. Amount: traceLiveFee (checkFeeAgainstSource on the fee's own document for a Knox fee). " +
  "Category: checkFeeCategory. A fee with no stored text is unknown and left out of the denominator. " +
  "Stored copies, not the bank's current schedule; rate fees are not sampled.";

export interface LiveAccuracy {
  readable: boolean;
  seed: string;
  sampled: number;
  scorable: number;
  noText: number;
  amountMiss: number;
  categoryMiss: number;
  /** Amount and category both supported by the stored source (not the receipt's figure). */
  amountAndCategory: number;
  /** amountAndCategory / scorable, or null with no scorable fee. */
  share: number | null;
  /** Two-sided 95% Wilson interval for that share (a fee-level diagnostic, not a launch bound). */
  range: { low: number; high: number } | null;
  /**
   * The daily receipt's own headline (`summarizeFreshAudit`): right / scorable, where right also needs
   * the bank's own document, a priced line and a clean name. Printed first.
   */
  right: number;
  rightShare: number | null;
  /** Two-sided 95% Wilson interval for the receipt's share. */
  rightRange: { low: number; high: number } | null;
  sourceCheckVersion: number;
  categoryGuardVersion: number;
  method: string;
}

export function liveAccuracyFrom(result: FreshAuditResult): LiveAccuracy {
  const amountAndCategory = result.scorable - result.amountMiss - result.categoryMiss;
  return {
    readable: result.readable,
    seed: result.seed,
    sampled: result.sampled,
    scorable: result.scorable,
    noText: result.noText,
    amountMiss: result.amountMiss,
    categoryMiss: result.categoryMiss,
    amountAndCategory,
    share: result.scorable > 0 ? amountAndCategory / result.scorable : null,
    range: wilsonRange(amountAndCategory, result.scorable),
    right: result.right,
    rightShare: result.scorable > 0 ? result.right / result.scorable : null,
    rightRange: wilsonRange(result.right, result.scorable),
    sourceCheckVersion: result.sourceCheckVersion,
    categoryGuardVersion: result.categoryGuardVersion,
    method: LIVE_ACCURACY_METHOD,
  };
}
