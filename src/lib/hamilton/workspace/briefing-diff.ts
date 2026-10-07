/**
 * What changed in an institution's Hamilton briefing since the last quarter's copy.
 *
 * Pure and client-safe: it compares two stored `Briefing` snapshots
 * (`hamilton_briefing_snapshots`, written by the `briefing-refresh` step) and never
 * builds a briefing itself. Wording follows the workspace contract in `types.ts`:
 * it reports what moved, with "higher" and "lower", and takes no stance on the price.
 */

import type { Briefing, FeePositionRow } from "./types";

export type BriefingChangeKind =
  | "own_price"
  | "peer_median"
  | "band_side"
  | "fee_added"
  | "fee_removed"
  | "observation_new"
  | "observation_gone"
  | "income";

export interface BriefingChange {
  kind: BriefingChangeKind;
  feeCategory: string | null;
  text: string;
}

export interface BriefingDiff {
  institutionId: number;
  fromQuarter: string;
  toQuarter: string;
  fromGeneratedAt: string;
  toGeneratedAt: string;
  changes: BriefingChange[];
}

/** "2026-Q4" for any date in October to December 2026 (UTC). */
export function briefingQuarter(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function delta(from: number, to: number): string {
  const diff = Math.round((to - from) * 100) / 100;
  return `${money(Math.abs(diff))} ${diff > 0 ? "higher" : "lower"}`;
}

type BandSide = "below" | "within" | "above";

function bandSide(row: FeePositionRow): BandSide | null {
  if (!row.band) return null;
  if (row.current < row.band.p25) return "below";
  if (row.current > row.band.p75) return "above";
  return "within";
}

const SIDE_TEXT: Record<BandSide, string> = {
  below: "below the middle half of peers",
  within: "within the middle half of peers",
  above: "above the middle half of peers",
};

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function feeChanges(previous: FeePositionRow[], current: FeePositionRow[]): BriefingChange[] {
  const before = new Map(previous.map((row) => [row.feeCategory, row]));
  const after = new Map(current.map((row) => [row.feeCategory, row]));
  const changes: BriefingChange[] = [];
  for (const row of current) {
    const old = before.get(row.feeCategory);
    const name = row.displayName;
    if (!old) {
      changes.push({ kind: "fee_added", feeCategory: row.feeCategory, text: `${name}: now on your published schedule at ${money(row.current)}.` });
      continue;
    }
    if (!same(old.current, row.current)) {
      changes.push({
        kind: "own_price",
        feeCategory: row.feeCategory,
        text: `${name}: your published price moved from ${money(old.current)} to ${money(row.current)} (${delta(old.current, row.current)}).`,
      });
    }
    if (old.band && row.band && !same(old.band.median, row.band.median)) {
      changes.push({
        kind: "peer_median",
        feeCategory: row.feeCategory,
        text: `${name}: the peer median moved from ${money(old.band.median)} to ${money(row.band.median)} (${delta(old.band.median, row.band.median)}; ${row.band.n} peers).`,
      });
    }
    const oldSide = bandSide(old);
    const newSide = bandSide(row);
    if (oldSide && newSide && oldSide !== newSide) {
      changes.push({
        kind: "band_side",
        feeCategory: row.feeCategory,
        text: `${name}: your price is now ${SIDE_TEXT[newSide]}; last quarter it was ${SIDE_TEXT[oldSide]}.`,
      });
    }
  }
  for (const row of previous) {
    if (!after.has(row.feeCategory)) {
      changes.push({ kind: "fee_removed", feeCategory: row.feeCategory, text: `${row.displayName}: no longer on your published schedule (was ${money(row.current)}).` });
    }
  }
  return changes;
}

function observationChanges(previous: Briefing, current: Briefing): BriefingChange[] {
  const before = new Set(previous.observations.map((o) => o.id));
  const after = new Set(current.observations.map((o) => o.id));
  const changes: BriefingChange[] = [];
  for (const observation of current.observations) {
    if (!before.has(observation.id)) {
      changes.push({ kind: "observation_new", feeCategory: observation.feeCategory, text: `New this quarter: ${observation.headline}` });
    }
  }
  for (const observation of previous.observations) {
    if (!after.has(observation.id)) {
      changes.push({ kind: "observation_gone", feeCategory: observation.feeCategory, text: `No longer flagged: ${observation.headline}` });
    }
  }
  return changes;
}

function incomeChange(previous: Briefing, current: Briefing): BriefingChange[] {
  const before = previous.institutionFinancials;
  const after = current.institutionFinancials;
  if (!after || !before || before.quarterEnd === after.quarterEnd) return [];
  const newest = after.quarters[0];
  if (!newest) return [];
  const yoy = after.yoyPct === null ? "" : ` Trailing four quarters are ${Math.abs(after.yoyPct).toFixed(1)}% ${after.yoyPct >= 0 ? "higher" : "lower"} than the four before.`;
  return [{
    kind: "income",
    feeCategory: null,
    text: `New filing: deposit service charge income for the quarter ending ${after.quarterEnd} was ${money(newest.amount)}.${yoy}`,
  }];
}

/** Pure: the changes between two briefing snapshots, own fees first. */
export function diffBriefings(
  previous: { quarter: string; briefing: Briefing },
  current: { quarter: string; briefing: Briefing },
): BriefingDiff {
  return {
    institutionId: current.briefing.institutionId,
    fromQuarter: previous.quarter,
    toQuarter: current.quarter,
    fromGeneratedAt: previous.briefing.generatedAt,
    toGeneratedAt: current.briefing.generatedAt,
    changes: [
      ...feeChanges(previous.briefing.positions ?? [], current.briefing.positions ?? []),
      ...incomeChange(previous.briefing, current.briefing),
      ...observationChanges(previous.briefing, current.briefing),
    ],
  };
}
