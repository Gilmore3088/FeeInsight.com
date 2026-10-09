/**
 * Briefing observations: what is worth investigating, ordered by how notable it is.
 * Pure. Never says which way a price should move; the reader decides what to test.
 *
 * Kinds built here, each only from data we hold:
 * - market_position: a published fee far from the peer group (bottom or top 15%).
 * - competitor_move: institutions in the bank's state or peer group changed a fee the
 *   bank also charges (fee_change_records).
 * - revenue_shift: the bank's deposit service charge income moved 15% or more year over
 *   year (call reports).
 * - rule_change (built in ./context): a regulator release whose title mentions fees,
 *   overdraft, NSF, Reg E or Reg DD (reg_articles).
 */

import { getDisplayName } from "@/lib/fee-taxonomy";
import { MIN_PEERS_FOR_POSITION, pricePosition } from "./scenario";
import type { Fact, FeePositionRow, Observation, SourceRef } from "./types";

export const POSITION_EXTREME_PCT = 15;
export const REVENUE_SHIFT_PCT = 15;
export const MAX_OBSERVATIONS = 5;

export interface FeePositionInput {
  feeCategory: string;
  current: number;
  peers: number[];
  peerLabel: string;
}

export interface FeeChangeInput {
  institutionName: string;
  feeCategory: string;
  oldAmount: number | null;
  newAmount: number | null;
  changedAt: string;
}

export interface ServiceChargeTrend {
  /** Trailing four quarters of deposit service charges, in dollars. */
  latestTtm: number;
  priorTtm: number;
  quarterEnd: string;
  source: "fdic" | "ncua" | "ffiec";
}

const CATALOG: SourceRef = { label: "Published fee schedules", table: "published_fee_catalog" };
const CHANGES: SourceRef = { label: "Fee changes seen on published schedules", table: "fee_change_records" };

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function fmtMillions(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Every reviewed fee against its peer band, in the order given: no ranking and no price direction. */
export function feePositionRows(positions: FeePositionInput[]): FeePositionRow[] {
  return positions.map((p) => {
    const sorted = [...p.peers].sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      feeCategory: p.feeCategory,
      displayName: getDisplayName(p.feeCategory),
      current: p.current,
      band:
        sorted.length >= MIN_PEERS_FOR_POSITION
          ? { p25: round(quantile(sorted, 0.25)), median: round(quantile(sorted, 0.5)), p75: round(quantile(sorted, 0.75)), n: sorted.length }
          : null,
      peerLabel: p.peerLabel,
    };
  });
}

export function marketPositionObservations(positions: FeePositionInput[]): Observation[] {
  const out: Observation[] = [];
  for (const p of positions) {
    if (p.peers.length < MIN_PEERS_FOR_POSITION) continue;
    const pos = pricePosition(p.current, p.peers);
    if (pos === null || (pos > POSITION_EXTREME_PCT && pos < 100 - POSITION_EXTREME_PCT)) continue;
    const name = getDisplayName(p.feeCategory);
    const sorted = [...p.peers].sort((a, b) => a - b);
    const higher = p.peers.filter((v) => v > p.current + 0.005).length;
    const lower = p.peers.filter((v) => v < p.current - 0.005).length;
    const n = p.peers.length;
    const headline =
      pos <= POSITION_EXTREME_PCT
        ? higher === n
          ? `Your ${name} of ${fmtMoney(p.current)} is the lowest of ${n} peers.`
          : `Your ${name} of ${fmtMoney(p.current)} is below ${higher} of ${n} peers.`
        : lower === n
          ? `Your ${name} of ${fmtMoney(p.current)} is the highest of ${n} peers.`
          : `Your ${name} of ${fmtMoney(p.current)} is above ${lower} of ${n} peers.`;
    const facts: Fact[] = [
      {
        text: `${p.peerLabel}: median ${fmtMoney(quantile(sorted, 0.5))}, middle half ${fmtMoney(quantile(sorted, 0.25))} to ${fmtMoney(quantile(sorted, 0.75))}, from ${n} institutions.`,
        source: CATALOG,
      },
    ];
    out.push({
      id: `market_position:${p.feeCategory}`,
      kind: "market_position",
      feeCategory: p.feeCategory,
      headline,
      facts,
      actions: ["compare_competitors", "research_fee", "model_price", "ask"],
      salience: Math.abs(pos - 50) / 50,
    });
  }
  return out;
}

export function competitorMoveObservations(
  changes: FeeChangeInput[],
  bankCategories: Set<string>,
  scopeLabel: string,
): Observation[] {
  const byCategory = new Map<string, FeeChangeInput[]>();
  for (const c of changes) {
    if (!bankCategories.has(c.feeCategory)) continue;
    if (c.oldAmount === null || c.newAmount === null || Math.abs(c.oldAmount - c.newAmount) < 0.005) continue;
    const list = byCategory.get(c.feeCategory) ?? [];
    list.push(c);
    byCategory.set(c.feeCategory, list);
  }
  const out: Observation[] = [];
  for (const [category, list] of byCategory) {
    const name = getDisplayName(category);
    const institutions = new Set(list.map((c) => c.institutionName));
    const sorted = [...list].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    const count = institutions.size;
    out.push({
      id: `competitor_move:${category}`,
      kind: "competitor_move",
      feeCategory: category,
      headline: `${count} ${count === 1 ? "institution" : "institutions"} in ${scopeLabel} changed their ${name}.`,
      facts: sorted.slice(0, 3).map((c) => ({
        text: `${c.institutionName}: ${fmtMoney(c.oldAmount as number)} to ${fmtMoney(c.newAmount as number)}, seen ${c.changedAt.slice(0, 10)}.`,
        source: { ...CHANGES, asOf: c.changedAt.slice(0, 10) },
      })),
      actions: ["compare_competitors", "research_fee", "ask"],
      salience: Math.min(1, 0.5 + 0.1 * count),
    });
  }
  return out;
}

export function revenueShiftObservation(trend: ServiceChargeTrend | null): Observation | null {
  if (!trend || trend.priorTtm <= 0) return null;
  const pct = ((trend.latestTtm - trend.priorTtm) / trend.priorTtm) * 100;
  if (Math.abs(pct) < REVENUE_SHIFT_PCT) return null;
  const regulator = trend.source === "ncua" ? "NCUA 5300 call report" : "FDIC call report";
  const source: SourceRef = { label: regulator, table: "institution_financial_records", asOf: trend.quarterEnd };
  return {
    id: "revenue_shift:service_charges",
    kind: "revenue_shift",
    feeCategory: null,
    headline: `Your deposit service charge income is ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% from a year earlier.`,
    facts: [
      { text: `Four quarters to ${trend.quarterEnd}: ${fmtMillions(trend.latestTtm)}.`, source },
      { text: `The four quarters before: ${fmtMillions(trend.priorTtm)}.`, source },
    ],
    actions: ["research_fee", "ask"],
    salience: Math.min(1, Math.abs(pct) / 50),
  };
}

/** The Briefing list: most notable first, capped so it stays a short read. */
export function rankObservations(observations: Observation[], limit = MAX_OBSERVATIONS): Observation[] {
  return [...observations].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id)).slice(0, limit);
}
