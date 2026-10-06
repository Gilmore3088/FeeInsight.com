/**
 * Decisions after the choice: watch conditions and the ledger. Pure and client-safe.
 *
 * - A watch condition names what would reopen a decision: a competitor changing the fee,
 *   the peer median moving, or a regulator release about the fee. When one trips, the
 *   decision goes back on the Briefing with the fact that tripped it.
 * - The ledger is a sum over decisions, never a separate counter. Dollars count only from
 *   an option chosen on the bank's own figures (institution evidence); everything else
 *   counts as decisions, not dollars.
 */

import type { DecisionEvent, DecisionRecord, DecisionStatus, EvidenceLevel, Fact, FeeResearch, WatchCondition } from "./types";
import { formatFeeAmount } from "@/lib/format";
import { proseFeeName } from "./names";

function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

export interface WatchState {
  condition: WatchCondition;
  tripped: boolean;
  /** The fact that tripped it, with its source. */
  evidence: Fact | null;
}

/** A peer median move at least this large (percent) reopens a decision. */
export const PEER_MEDIAN_WATCH_PCT = 5;

/** The watches set when management chooses an option. */
export function defaultWatches(research: FeeResearch): WatchCondition[] {
  const name = proseFeeName(research.feeCategory);
  const out: WatchCondition[] = [
    { kind: "competitor_change", feeCategory: research.feeCategory, label: `A competitor in your state changes its ${name} fee` },
    { kind: "rule_release", feeCategory: research.feeCategory, label: `A regulator release mentions the ${name} fee` },
  ];
  if (research.band) {
    out.splice(1, 0, {
      kind: "peer_median_change",
      feeCategory: research.feeCategory,
      baseline: research.band.median,
      thresholdPct: PEER_MEDIAN_WATCH_PCT,
      label: `The peer median moves ${PEER_MEDIAN_WATCH_PCT}% from ${money(research.band.median)}`,
    });
  }
  return out;
}

/** Reads stored watch conditions, dropping anything that is not one. */
export function parseWatches(value: unknown): WatchCondition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((w): w is WatchCondition => {
    if (!w || typeof w !== "object") return false;
    const c = w as Record<string, unknown>;
    if (typeof c.feeCategory !== "string" || typeof c.label !== "string") return false;
    if (c.kind === "peer_median_change") return typeof c.baseline === "number" && typeof c.thresholdPct === "number";
    return c.kind === "competitor_change" || c.kind === "rule_release";
  });
}

function newer(fact: Fact, since: string): boolean {
  const asOf = fact.source.asOf;
  return Boolean(asOf) && String(asOf).slice(0, 10) > since.slice(0, 10);
}

/** Each watch against today's research; `since` is when the decision was made (ISO). */
export function evaluateWatches(conditions: WatchCondition[], research: FeeResearch, since: string): WatchState[] {
  return conditions.map((condition) => {
    if (condition.feeCategory !== research.feeCategory) return { condition, tripped: false, evidence: null };
    if (condition.kind === "competitor_change") {
      const fact = research.recentChanges.find((f) => newer(f, since)) ?? null;
      return { condition, tripped: Boolean(fact), evidence: fact };
    }
    if (condition.kind === "rule_release") {
      const fact = research.regulation.find((f) => f.source.table === "reg_articles" && newer(f, since)) ?? null;
      return { condition, tripped: Boolean(fact), evidence: fact };
    }
    const band = research.band;
    if (!band || condition.baseline <= 0) return { condition, tripped: false, evidence: null };
    const movePct = ((band.median - condition.baseline) / condition.baseline) * 100;
    const tripped = Math.abs(movePct) >= condition.thresholdPct;
    return {
      condition,
      tripped,
      evidence: tripped
        ? {
            text: `The peer median is ${money(band.median)} across ${band.n} peers, ${movePct > 0 ? "up" : "down"} ${Math.abs(movePct).toFixed(1)}% from ${money(condition.baseline)}.`,
            source: { label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog", asOf: research.provenance.dataAsOf.fees ?? null },
            sampleSize: band.n,
          }
        : null,
    };
  });
}

// ─── The ledger ──────────────────────────────────────────────────────────────

export interface LedgerLine {
  decisionId: string;
  title: string;
  feeCategory: string | null;
  status: DecisionStatus;
  chosenAmount: number | null;
  /** Annual fee income effect of the chosen option, only on institution evidence. */
  annualEffect: { low: number; high: number } | null;
  evidenceLevel: EvidenceLevel | null;
}

export interface Ledger {
  decisions: number;
  byStatus: Record<DecisionStatus, number>;
  /** Decisions with an option chosen (decided and after, not closed without one). */
  chosen: number;
  /** Sum of annual effects over decisions chosen on the bank's own figures. */
  dollars: { low: number; high: number; decisions: number };
  lines: LedgerLine[];
}

const STATUSES: DecisionStatus[] = ["researching", "modeling", "decided", "implementing", "monitoring", "closed"];

function lastChoice(events: DecisionEvent[]): DecisionEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "option_chosen") return events[i];
  return null;
}

export function buildLedger(decisions: DecisionRecord[], eventsByDecision: Map<string, DecisionEvent[]>): Ledger {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<DecisionStatus, number>;
  const lines: LedgerLine[] = [];
  const dollars = { low: 0, high: 0, decisions: 0 };
  let chosen = 0;
  for (const d of decisions) {
    byStatus[d.status]++;
    const choice = lastChoice(eventsByDecision.get(d.id) ?? []);
    const evidence = (choice?.detail.evidenceLevel as EvidenceLevel | undefined) ?? null;
    const effect = choice?.detail.revenueEffect as { low?: unknown; high?: unknown } | null | undefined;
    const annualEffect =
      evidence === "institution" && effect && typeof effect.low === "number" && typeof effect.high === "number"
        ? { low: effect.low, high: effect.high }
        : null;
    if (choice) chosen++;
    if (annualEffect) {
      dollars.low += annualEffect.low;
      dollars.high += annualEffect.high;
      dollars.decisions++;
    }
    lines.push({ decisionId: d.id, title: d.title, feeCategory: d.feeCategory, status: d.status, chosenAmount: d.chosenAmount, annualEffect, evidenceLevel: evidence });
  }
  return { decisions: decisions.length, byStatus, chosen, dollars, lines };
}
