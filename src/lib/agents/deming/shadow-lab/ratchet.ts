import { matches } from "./metrics";
import type { CaseTrace, FeeRef, ShadowCase } from "./types";

/**
 * The shadow lab's ratchet: every expectation today's pipeline meets is listed in a committed
 * baseline. A change that loses one (a fee no longer read, a wrong fee published again) fails the
 * quality gates; a change that meets a new one must lock it in by refreshing the baseline in the
 * same PR. So the pipeline only moves one way.
 */

export interface RatchetBaseline {
  held: string[];
}

const feeId = (ref: FeeRef) => `${ref.canonicalFeeKey}:${ref.amountCents}`;

/** The id of every expectation the traces meet, sorted. Cases that are not ok meet none. */
export function heldExpectations(cases: ShadowCase[], traces: CaseTrace[]): string[] {
  const byKey = new Map(traces.map((trace) => [trace.caseKey, trace]));
  const held: string[] = [];
  for (const c of cases) {
    const trace = byKey.get(c.caseKey);
    if (c.status !== "ok" || !trace) continue;
    const published = trace.published;
    for (const ref of c.expected.publish) {
      if (published.some((fee) => matches(ref, fee))) held.push(`${c.caseKey}|publish|${feeId(ref)}`);
    }
    for (const ref of c.expected.forbid) {
      if (!published.some((fee) => matches(ref, fee))) held.push(`${c.caseKey}|forbid|${feeId(ref)}`);
    }
    const target = c.expected.publishCount;
    if (target) {
      const ref: FeeRef = { canonicalFeeKey: target.canonicalFeeKey, feeName: null, amountCents: target.amountCents };
      if (published.filter((fee) => matches(ref, fee)).length === target.count) held.push(`${c.caseKey}|count|${feeId(ref)}`);
    }
    if (c.expected.documentIsSchedule !== undefined && trace.documentAccepted === c.expected.documentIsSchedule) {
      held.push(`${c.caseKey}|document`);
    }
  }
  return [...new Set(held)].sort();
}

export function compareToBaseline(baseline: RatchetBaseline, held: string[]): { regressions: string[]; gains: string[] } {
  const now = new Set(held);
  const before = new Set(baseline.held);
  return {
    regressions: baseline.held.filter((id) => !now.has(id)),
    gains: held.filter((id) => !before.has(id)),
  };
}
