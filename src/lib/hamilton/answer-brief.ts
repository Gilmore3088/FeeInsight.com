/**
 * The institution's standing figures, printed behind any saved answer when it is exported: every
 * published fee against its peer median, its fee income by quarter against the median of its
 * charter and size, and how much of its fee income gap its prices account for. Every figure comes
 * from the engine (published fee schedules and call reports); nothing here is model-written.
 * Server only.
 */

import { getServiceChargeIntensity } from "@/lib/data-store/call-reports";
import { ASSET_TIER_RANGES } from "./peer-index";
import { getWorkspaceBriefing } from "./workspace/research";
import { scheduleOverview } from "./workspace/schedule";
import type { InstitutionFinancials, SchedulePosition } from "./workspace/types";
import { explainIncome, incomeSplit, type IncomeExplanation, type IncomeSplit } from "./workspace/why";

export interface AnswerBrief {
  /** Every fee with a peer comparison, furthest from its median first. */
  positions: SchedulePosition[];
  /** Fees on the schedule with too few peers publishing them to compare. */
  uncompared: number;
  financials: InstitutionFinancials | null;
  income: { split: IncomeSplit; explained: IncomeExplanation } | null;
}

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
  const split = intensity ? incomeSplit(intensity, briefing.positions, peerPhrase(intensity.charterType, intensity.assetTier)) : null;
  return {
    positions: overview.positions,
    uncompared: briefing.positions.length - overview.positions.length,
    financials: briefing.institutionFinancials,
    income: split ? { split, explained: explainIncome(split) } : null,
  };
}
