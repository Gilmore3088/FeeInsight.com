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
import { countedAmounts } from "@/lib/data-store/counted-amounts";
import { midRankPercentile, SAME_PRICE_TOLERANCE } from "@/lib/percentile";
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

/**
 * Fewer peers than this and a percentile says more than the data does: 10 for every peer group,
 * 5 for local competitors (James, 2026-10-25; docs/project/DECISIONS.md).
 */
export const MIN_PEERS_FOR_POSITION = 10;
export const MIN_LOCAL_PEERS_FOR_POSITION = 5;

/** The label a comparison group carries when it is the bank's local competitors. */
export const LOCAL_COMPETITORS_GROUP = "local competitors";

/** The minimum for a group by its label: local competitors need 5, every other group 10. */
export function minPeersForGroup(groupLabel: string): number {
  return groupLabel === LOCAL_COMPETITORS_GROUP ? MIN_LOCAL_PEERS_FOR_POSITION : MIN_PEERS_FOR_POSITION;
}

function fmtMoney(n: number): string {
  const cents = Math.abs(n % 1) > SAME_PRICE_TOLERANCE;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Where a price sits among peers, in words: "below all 5 peers" when every peer charges more,
 * "above all 5 peers" when every one charges less, else "at the 40th percentile of 14 peers".
 * A "0th percentile" reads as an error to a reader. With more than 100 peers a rounded 0 or 100
 * no longer means every peer, so the percentile stays. `short` drops "of 14 peers" from a percentile,
 * for a sentence that already says how many peers there are.
 */
export function placeAmong(position: number, n: number, short = false): string {
  const many = fmtCount(n);
  if (n <= 100 && position === 0) return `below all ${many} peers`;
  if (n <= 100 && position === 100) return `above all ${many} peers`;
  return `at the ${fmtOrdinal(position)} percentile${short ? "" : ` of ${many} peers`}`;
}

/** "$25" when both ends are the same, else "$25 to $30": a range of one value reads as a typo. */
export function spanOf(lo: string, hi: string): string {
  return lo === hi ? lo : `${lo} to ${hi}`;
}

/**
 * The shared mid-rank percentile (#2048), once enough peers publish the fee to place a price.
 * `minPeers` is MIN_LOCAL_PEERS_FOR_POSITION for local competitors, else the default.
 */
export function pricePosition(price: number, peers: number[], minPeers = MIN_PEERS_FOR_POSITION): number | null {
  if (peers.length < minPeers) return null;
  return midRankPercentile(price, peers);
}

/**
 * The amounts a fee's percentile ranks against: the band's own, one per institution and sister
 * charters of one schedule once, so "the Nth percentile of N peers" counts one population.
 */
export function countedPeerAmounts(research: { peers: readonly { institutionId: number; amount: number; countedAs?: number }[] }): number[] {
  return countedAmounts(research.peers);
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
    peerGroup: { label: input.peerLabel.split(";")[0].trim(), n: input.peers.length },
    dataAsOf: { fees: input.feesAsOf ?? null, financials: line?.quarterEnd ?? null },
    sources: line ? [PEER_SOURCE, line.source] : [PEER_SOURCE],
    assumptions,
    clientFacts,
  };
}

export function buildScenario(input: ScenarioInput): Scenario {
  const { feeCategory, current, tested, peers } = input;
  // The group's name only: a thin fee's label also carries "; only 3 of them publish this fee".
  const group = input.peerLabel.split(";")[0].trim();
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
    peerLabel: group,
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
      ? `Only ${peers.length} peers in ${group} publish this fee, too few for a percentile.`
      : `Position is among ${peers.length} institutions in ${group} that publish this fee.`;

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
      ? "No current filing reports income for this fee on its own, so there is no dollar estimate from public data."
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
