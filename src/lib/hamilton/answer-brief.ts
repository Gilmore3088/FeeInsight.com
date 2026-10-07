/**
 * The institution's standing figures, printed behind any saved answer when it is exported: every
 * published fee against its peer median, its fee income by quarter against the median of its
 * charter and size, and how much of its fee income gap its prices account for. Every figure comes
 * from the engine (published fee schedules and call reports); nothing here is model-written.
 * Server only.
 */

import { getServiceChargeIntensity } from "@/lib/data-store/call-reports";
import { ASSET_TIER_RANGES } from "./peer-index";
import { getFeeResearch, getWorkspaceBriefing } from "./workspace/research";
import { scheduleOverview } from "./workspace/schedule";
import type { FeePositionRow, InstitutionFinancials, SchedulePosition } from "./workspace/types";
import { explainIncome, incomeSplit, type IncomeExplanation, type IncomeSplit } from "./workspace/why";

export interface AnswerBrief {
  /** Every fee with a peer comparison, furthest from its median first. */
  positions: SchedulePosition[];
  /** The same fees with their peers' middle half, for the range chart. */
  bands: Record<string, { p25: number; median: number; p75: number }>;
  /** Named local competitors' prices for the fees furthest from their medians. */
  competitors: LocalCompetitorFee[];
  /** Fees on the schedule with too few peers publishing them to compare. */
  uncompared: number;
  financials: InstitutionFinancials | null;
  income: { split: IncomeSplit; explained: IncomeExplanation } | null;
}

export interface LocalCompetitorFee {
  feeCategory: string;
  displayName: string;
  own: number;
  /** Largest local deposits first. */
  competitors: { name: string; amount: number }[];
  /** Where the market is drawn from, e.g. "Melbourne, FL". */
  place: string | null;
}

/** Fees charted against local competitors: the furthest from their medians with three or more named competitors. */
const COMPETITOR_FEES = 3;
const MIN_COMPETITORS = 3;
/** Fees looked up before giving up, so a bank with few local competitors costs a bounded number of reads. */
const COMPETITOR_LOOKUPS = 6;

/** "banks with $300M to $1B in assets" */
export function peerPhrase(charterType: string, assetTier: string): string {
  const kind = charterType === "credit_union" ? "credit unions" : "banks";
  const range = ASSET_TIER_RANGES[assetTier];
  return range ? `${kind} with ${range} in assets` : `${kind} of the same size`;
}

export async function loadAnswerBrief(institutionId: number): Promise<AnswerBrief | null> {
  const [briefing, intensity] = await Promise.all([
    getWorkspaceBriefing(institutionId).catch((error) => {
      console.error("[answer-brief] briefing failed", error);
      return null;
    }),
    getServiceChargeIntensity(institutionId).catch((error) => {
      console.error("[answer-brief] income intensity failed", error);
      return null;
    }),
  ]);
  if (!briefing) return null;
  const overview = scheduleOverview(briefing.positions);
  const bands: AnswerBrief["bands"] = {};
  for (const row of briefing.positions as FeePositionRow[]) {
    if (row.band) bands[row.feeCategory] = { p25: row.band.p25, median: row.band.median, p75: row.band.p75 };
  }
  const competitors: LocalCompetitorFee[] = [];
  for (const p of overview.positions.slice(0, COMPETITOR_LOOKUPS)) {
    if (competitors.length >= COMPETITOR_FEES) break;
    const research = await getFeeResearch(institutionId, p.feeCategory).catch(() => null);
    const local = research?.localCompetitors ?? [];
    if (local.length < MIN_COMPETITORS) continue;
    competitors.push({
      feeCategory: p.feeCategory,
      displayName: p.displayName,
      own: p.current,
      competitors: local.slice(0, 8).map((c) => ({ name: c.institutionName, amount: c.amount })),
      place: research?.localMarket?.places[0] ?? null,
    });
  }
  const split = intensity ? incomeSplit(intensity, briefing.positions, peerPhrase(intensity.charterType, intensity.assetTier)) : null;
  return {
    positions: overview.positions,
    bands,
    competitors,
    uncompared: briefing.positions.length - overview.positions.length,
    financials: briefing.institutionFinancials,
    income: split ? { split, explained: explainIncome(split) } : null,
  };
}
