/**
 * What changed in an institution's Hamilton briefing since the last quarter's copy.
 *
 * Pure and client-safe: it compares two stored `Briefing` snapshots
 * (`hamilton_briefing_snapshots`, written by the `briefing-refresh` step) and never
 * builds a briefing itself. Wording follows the workspace contract in `types.ts`:
 * it reports what moved, with "higher" and "lower", and takes no stance on the price.
 */

import { PRO_STUDIES } from "./studies";
import type { Briefing, FeePositionRow, Observation } from "./types";

export type BriefingChangeKind =
  | "own_price"
  | "peer_median"
  | "peer_group"
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
  /** The peer group each stored copy was read against (the institution's default group then). */
  fromPeerLabel: string;
  toPeerLabel: string;
  changes: BriefingChange[];
}

/** "2026-Q4" for any date in October to December 2026 (UTC). */
export function briefingQuarter(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** "Q4 2026" for "2026-Q4", as a reader writes it. */
export function quarterLabel(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return m ? `Q${m[2]} ${m[1]}` : quarter;
}

/** "2027-Q1" after "2026-Q4". */
export function nextQuarter(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return quarter;
  const q = Number(m[2]);
  return q === 4 ? `${Number(m[1]) + 1}-Q1` : `${m[1]}-Q${q + 1}`;
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
      changes.push({ kind: "fee_added", feeCategory: row.feeCategory, text: `${name}: now on its published schedule at ${money(row.current)}.` });
      continue;
    }
    if (!same(old.current, row.current)) {
      changes.push({
        kind: "own_price",
        feeCategory: row.feeCategory,
        text: `${name}: its published price moved from ${money(old.current)} to ${money(row.current)} (${delta(old.current, row.current)}).`,
      });
    }
    if (old.peerLabel !== row.peerLabel) {
      // A different peer group is not a market move: name the change and compare nothing across it.
      changes.push({
        kind: "peer_group",
        feeCategory: row.feeCategory,
        text: `${name}: now compared with ${row.peerLabel} (last quarter ${old.peerLabel}), so its peer figures are not compared.`,
      });
      continue;
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
        text: `${name}: its price is now ${SIDE_TEXT[newSide]}; last quarter it was ${SIDE_TEXT[oldSide]}.`,
      });
    }
  }
  for (const row of previous) {
    if (!after.has(row.feeCategory)) {
      changes.push({ kind: "fee_removed", feeCategory: row.feeCategory, text: `${row.displayName}: no longer on its published schedule (was ${money(row.current)}).` });
    }
  }
  return changes;
}

/**
 * Snapshots stored before #1255 can hold studies now held off Pro surfaces (#1082). Leave those
 * out on both sides, so a held study never shows as "No longer flagged" or "New this quarter".
 */
function shownObservations(briefing: Briefing): Observation[] {
  return briefing.observations.filter(
    (o) => o.kind !== "study" || !o.id.startsWith("study:") || PRO_STUDIES.has(o.id.slice("study:".length)),
  );
}

function observationChanges(previous: Briefing, current: Briefing): BriefingChange[] {
  const previousShown = shownObservations(previous);
  const currentShown = shownObservations(current);
  const before = new Set(previousShown.map((o) => o.id));
  const after = new Set(currentShown.map((o) => o.id));
  const changes: BriefingChange[] = [];
  for (const observation of currentShown) {
    if (!before.has(observation.id)) {
      changes.push({ kind: "observation_new", feeCategory: observation.feeCategory, text: `New this quarter: ${observation.headline}` });
    }
  }
  for (const observation of previousShown) {
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
    fromPeerLabel: previous.briefing.peerLabel,
    toPeerLabel: current.briefing.peerLabel,
    changes: [
      ...feeChanges(previous.briefing.positions ?? [], current.briefing.positions ?? []),
      ...incomeChange(previous.briefing, current.briefing),
      ...observationChanges(previous.briefing, current.briefing),
    ],
  };
}
