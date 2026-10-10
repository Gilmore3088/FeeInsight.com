/**
 * Model a price the bank asks about. Pure and client-safe, so the Model screen can
 * recompute as the reader types.
 *
 * Three levels of evidence, always labeled:
 * - market: position against peers and per-1,000-items arithmetic; no dollar total,
 *   because public data has no event counts for one fee.
 * - working_estimate: the bank's own reported income for this fee line divided by the
 *   published fee gives implied paid items (already net of waivers).
 * - institution: annual items and waiver rate the bank gave Hamilton.
 *
 * The tested price is the reader's choice. Nothing here suggests one.
 */

import { proseFeeName } from "./names";
import {
  WORKSPACE_ENGINE_VERSION,
  type ClarifyingQuestion,
  type ClientFactRef,
  type EvidenceLevel,
  type Provenance,
  type Scenario,
  type ScenarioInput,
  type SourceRef,
} from "./types";

/** Fewer peers than this and a percentile says more than the data does. */
export const MIN_PEERS_FOR_POSITION = 5;
const SAME_PRICE_TOLERANCE = 0.005;

function fmtMoney(n: number): string {
  const cents = Math.abs(n % 1) > SAME_PRICE_TOLERANCE;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Mid-rank percentile: share of peers below the price plus half of those equal to it. */
export function pricePosition(price: number, peers: number[]): number | null {
  if (peers.length < MIN_PEERS_FOR_POSITION) return null;
  let below = 0;
  let same = 0;
  for (const p of peers) {
    if (Math.abs(p - price) <= SAME_PRICE_TOLERANCE) same++;
    else if (p < price) below++;
  }
  return Math.round(((below + same / 2) / peers.length) * 100);
}

export function annualItemsQuestion(feeCategory: string, institutionName?: string): ClarifyingQuestion {
  return {
    prompt: `About how many ${proseFeeName(feeCategory)} fees did ${institutionName ?? "you"} charge in the last 12 months, before waivers?`,
    inputKind: "number",
    fieldKey: `fee.${feeCategory}.annual_items`,
  };
}

export function waiverRateQuestion(feeCategory: string, institutionName?: string): ClarifyingQuestion {
  return {
    prompt: `About what share of ${proseFeeName(feeCategory)} fees did ${institutionName ?? "you"} waive or refund in the last 12 months?`,
    inputKind: "percent",
    fieldKey: `fee.${feeCategory}.waiver_rate`,
  };
}

function revenueRange(
  paidItems: number,
  current: number,
  tested: number,
  volumeChangePct: [number, number] | null | undefined,
): { low: number; high: number } {
  const changes = volumeChangePct ?? [0, 0];
  const outcomes = changes.map((pct) => paidItems * (1 + pct / 100) * tested - paidItems * current);
  return { low: Math.round(Math.min(...outcomes)), high: Math.round(Math.max(...outcomes)) };
}

function volumeAssumption(tested: number, volumeChangePct: [number, number] | null | undefined): string {
  if (!volumeChangePct) {
    return `Assumes the number of items stays the same at ${fmtMoney(tested)}. Hamilton has no public source for how volume responds to price; set an expected change to see a range.`;
  }
  const [a, b] = volumeChangePct;
  return `Item volume at ${fmtMoney(tested)} changes by ${Math.min(a, b)}% to ${Math.max(a, b)}%, as you set it.`;
}

const PEER_SOURCE: SourceRef = {
  label: "Fees on each peer's own published schedule (verified, live)",
  table: "published_fee_catalog",
};

function scenarioProvenance(
  input: ScenarioInput,
  evidenceLevel: EvidenceLevel,
  assumptions: string[],
  clientFacts: ClientFactRef[],
): Provenance {
  const line = evidenceLevel === "working_estimate" ? input.revenueLine : null;
  return {
    engineVersion: WORKSPACE_ENGINE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evidenceLevel,
    peerGroup: { label: input.peerLabel, n: input.peers.length },
    dataAsOf: { fees: input.feesAsOf ?? null, financials: line?.quarterEnd ?? null },
    sources: line ? [PEER_SOURCE, line.source] : [PEER_SOURCE],
    assumptions,
    clientFacts,
  };
}

export function buildScenario(input: ScenarioInput): Scenario {
  const { feeCategory, current, tested, peers, peerLabel } = input;
  let peersMore = 0;
  let peersSame = 0;
  let peersLess = 0;
  for (const p of peers) {
    if (Math.abs(p - tested) <= SAME_PRICE_TOLERANCE) peersSame++;
    else if (p > tested) peersMore++;
    else peersLess++;
  }

  const base = {
    feeCategory,
    current,
    tested,
    peerLabel,
    n: peers.length,
    peersMore,
    peersSame,
    peersLess,
    positionBefore: pricePosition(current, peers),
    positionAfter: pricePosition(tested, peers),
    per1000ItemsDelta: Math.round((tested - current) * 1000),
  };
  const peerAssumption =
    peers.length < MIN_PEERS_FOR_POSITION
      ? `Only ${peers.length} peers in ${peerLabel} publish this fee, too few for a percentile.`
      : `Position is among ${peers.length} institutions in ${peerLabel} that publish this fee.`;

  const facts = input.institutionFacts;
  if (facts?.annualItems !== undefined && facts.annualItems >= 0) {
    const waiver = Math.min(Math.max(facts.waiverRate ?? 0, 0), 1);
    const paidItems = facts.annualItems * (1 - waiver);
    const assumptions = [
      peerAssumption,
      `${fmtCount(facts.annualItems)} items a year, as you gave them, with ${Math.round(waiver * 100)}% waived or refunded${facts.waiverRate === undefined ? " (no waiver rate given yet, so none is assumed)" : ""}.`,
      volumeAssumption(tested, input.volumeChangePct),
    ];
    return {
      ...base,
      revenueEffect: revenueRange(paidItems, current, tested, input.volumeChangePct),
      evidenceLevel: "institution",
      assumptions,
      factIds: (facts.refs ?? []).map((r) => r.factId),
      provenance: scenarioProvenance(input, "institution", assumptions, facts.refs ?? []),
      missingInput: facts.waiverRate === undefined ? waiverRateQuestion(feeCategory, input.subjectName) : null,
    };
  }

  const line = input.revenueLine;
  if (line && line.annualIncome > 0 && current > 0) {
    const impliedPaid = line.annualIncome / current;
    const assumptions = [
      peerAssumption,
      `Implied paid items: ${fmtMoney(line.annualIncome)} reported (${line.label}, four quarters to ${line.quarterEnd}) ÷ ${fmtMoney(current)} ≈ ${fmtCount(impliedPaid)} a year. Waivers are already netted out.`,
      "Treats every paid item as charged the published amount; tiered or capped fees make this approximate.",
      ...(line.combinedWith
        ? [`The filed line also includes ${line.combinedWith} income, so this overstates the base for this fee alone.`]
        : []),
      volumeAssumption(tested, input.volumeChangePct),
    ];
    return {
      ...base,
      revenueEffect: revenueRange(impliedPaid, current, tested, input.volumeChangePct),
      evidenceLevel: "working_estimate",
      assumptions,
      factIds: [],
      provenance: scenarioProvenance(input, "working_estimate", assumptions, []),
      missingInput: annualItemsQuestion(feeCategory, input.subjectName),
    };
  }

  const assumptions = [
    peerAssumption,
    line === undefined || line === null
      ? "No filing reports income for this fee on its own, so there is no dollar estimate from public data."
      : "The reported income for this fee cannot support an estimate at the current price.",
  ];
  return {
    ...base,
    revenueEffect: null,
    evidenceLevel: "market",
    assumptions,
    factIds: [],
    provenance: scenarioProvenance(input, "market", assumptions, []),
    missingInput: annualItemsQuestion(feeCategory, input.subjectName),
  };
}
