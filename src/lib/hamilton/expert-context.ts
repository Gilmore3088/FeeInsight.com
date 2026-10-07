/**
 * The state banking context around an institution's fees on the Benchmark page: the
 * state expert, the state regulator, and state medians from published fees. Economy,
 * Beige Book and regulatory news come from the shared getStateEconomicContext reader.
 * Read-only and deterministic: every line is a stored fact, never generated text.
 */

import { sql } from "@/lib/data-store/connection";
import { ALL_TIERS, loadStatePeerLevels, PEER_MIN_INSTITUTIONS } from "@/lib/agents/state-expert/memory";
import { stateExpertFor } from "@/lib/agents/state-expert/roster";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import { STATE_NAMES } from "@/lib/us-states";

export interface StateMedian {
  median: number;
  p25: number;
  p75: number;
  count: number;
}

export interface ExpertStateContext {
  stateCode: string;
  stateName: string;
  expertName: string | null;
  expertBio: string | null;
  regulator: string | null;
  regulatorUrl: string | null;
  /** Set only where credit unions are chartered by a different agency than banks. */
  creditUnionRegulator: string | null;
  /** State-wide medians by fee category, only where at least PEER_MIN_INSTITUTIONS publish the fee. */
  medians: Record<string, StateMedian>;
}

export async function fetchStateContext(stateCode: string): Promise<ExpertStateContext | null> {
  const code = stateCode.trim().toUpperCase();
  const stateName = STATE_NAMES[code];
  if (!stateName) return null;
  const expert = stateExpertFor(code);
  const regulator = STATE_REGULATORS.find((entry) => entry.stateCode === code) ?? null;
  const levels = await loadStatePeerLevels(sql, code).catch(() => []);
  const medians: Record<string, StateMedian> = {};
  for (const level of levels) {
    if (level.tier !== ALL_TIERS || level.count < PEER_MIN_INSTITUTIONS) continue;
    medians[level.canonicalFeeKey] = { median: level.median, p25: level.p25, p75: level.p75, count: level.count };
  }
  return {
    stateCode: code,
    stateName,
    expertName: expert?.name ?? null,
    expertBio: expert?.bio ?? null,
    regulator: regulator?.agency ?? null,
    regulatorUrl: regulator?.website ?? null,
    creditUnionRegulator: regulator?.creditUnionAgency ?? null,
    medians,
  };
}

/** The opening sentences of a Beige Book summary, whole sentences only, about two lines. */
export function beigeBookSummary(content: string, maxLength = 280): string {
  const sentences = content.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let text = "";
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (text && next.length > maxLength) break;
    text = next;
  }
  return text;
}
