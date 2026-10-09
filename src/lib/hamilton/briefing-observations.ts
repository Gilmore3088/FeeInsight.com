/**
 * This month's "things worth your attention", built from the Hamilton engine's Briefing (PR 170):
 * fees far from their peer group, competitors in the bank's state that changed a fee it charges,
 * a large move in its service charge income, and where it sits in one of Hamilton's studies (kept
 * in the last place). Overdraft, Hamilton's flagship, always leads when the bank publishes it. Deterministic and neutral: it says what is unusual, never what to do.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { Briefing, Observation } from "./workspace/types";

export interface AttentionItem {
  id: string;
  /** Null for items about the whole schedule, such as service charge income. */
  feeCategory: string | null;
  headline: string;
  facts: string[];
  /** A caution about the evidence, such as a small peer group. */
  note: string | null;
}

/** Display names carry abbreviations like "Overdraft (OD)"; prose reads better without them. */
export function plainFeeName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Overdraft is Hamilton's flagship: when the bank publishes it, it always leads the Briefing. */
export const FLAGSHIP_FEE = "overdraft";

function plainText(text: string): string {
  return text.replace(/\s*\([A-Z]{2,6}\)/g, "");
}

/** A fee's name as it reads mid-sentence: "Non-Network ATM" becomes "non-network ATM". */
export function proseFeeName(displayName: string): string {
  return plainFeeName(displayName)
    .split(" ")
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

function fromObservation(o: Observation): AttentionItem {
  // Study observations are already written in prose.
  if (o.kind === "study") return { id: o.id, feeCategory: o.feeCategory, headline: o.headline, facts: o.facts.map((f) => f.text), note: null };
  const display = o.feeCategory ? getDisplayName(o.feeCategory) : null;
  const prose = display ? proseFeeName(display) : null;
  const tidy = (text: string) => {
    let out = text;
    if (display && prose) {
      out = out.split(display).join(prose).split(plainFeeName(display)).join(prose);
      if (!/fee/i.test(prose)) out = out.replace(`Your ${prose} `, `Your ${prose} fee `).replace(`published ${prose}:`, `published ${prose} fee:`);
    }
    return plainText(out);
  };
  return {
    id: o.id,
    feeCategory: o.feeCategory,
    headline: tidy(o.headline),
    facts: o.facts.map((f) => tidy(f.text)),
    note: null,
  };
}

/** Studies that read better on their own page than as one of the month's few observations. */
const OFF_BRIEFING = new Set(["study:inferred_items_paid"]);

/**
 * What stands out this month, at most three. Overdraft leads only when it is itself unusual: a fee
 * at its peers' median is in the scorecard, not here. A fee whose peers charge it on mixed bases
 * (per item and monthly, say) has no single median to stand out from, so it is left out; so is
 * the inferred items-paid study, whose filing year runs behind the month.
 */
export function buildAttentionItems(
  briefing: Briefing | null,
  options: { mixedBasis?: ReadonlySet<string>; limit?: number } = {},
): AttentionItem[] {
  if (!briefing) return [];
  const limit = options.limit ?? 3;
  const mixed = options.mixedBasis ?? new Set<string>();
  const kept = briefing.observations.filter(
    (o) =>
      !OFF_BRIEFING.has(o.id) &&
      !(o.kind === "market_position" && o.feeCategory != null && mixed.has(o.feeCategory)),
  );
  const flagged = kept.find((o) => o.feeCategory === FLAGSHIP_FEE && o.kind === "market_position");
  const ordered = flagged ? [flagged, ...kept.filter((o) => o !== flagged)] : kept;
  const items = ordered.map(fromObservation).slice(0, limit);
  // Every briefing places the bank in a study when it has one: it keeps the last place.
  const study = kept.find((o) => o.kind === "study");
  if (study && limit > 0 && !items.some((i) => i.id === study.id) && items.length === limit) {
    items.splice(limit - 1, 1, fromObservation(study));
  }
  return items;
}

/** The month at a glance: where the schedule sits, what moved in the market, and fee income. */
export interface BriefingOverview {
  feesCompared: number;
  higher: number;
  inLine: number;
  lower: number;
  /** Peer institutions behind the comparison. */
  peerCount: number;
  stateLabel: string | null;
  /** Fees the bank charges that an institution in its state changed (confirmed changes), in the window. */
  feesChangedNearby: number;
  income: { latestTtm: number; yoyPct: number | null; quarterEnd: string; source: "fdic" | "ncua" } | null;
}

export function buildBriefingOverview(briefing: Briefing, stateLabel: string | null): BriefingOverview {
  const banded = briefing.positions.filter((p) => p.band);
  const higher = banded.filter((p) => p.current > p.band!.p75).length;
  const lower = banded.filter((p) => p.current < p.band!.p25).length;
  const feesChangedNearby = briefing.observations.filter((o) => o.kind === "competitor_move").length;
  const fin = briefing.institutionFinancials;
  return {
    feesCompared: banded.length,
    higher,
    inLine: banded.length - higher - lower,
    lower,
    peerCount: briefing.provenance.peerGroup?.n ?? 0,
    stateLabel,
    feesChangedNearby,
    income:
      fin && fin.latestTtm != null
        ? { latestTtm: fin.latestTtm, yoyPct: fin.yoyPct, quarterEnd: fin.quarterEnd, source: fin.source }
        : null,
  };
}
