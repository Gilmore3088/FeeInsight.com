/**
 * State Fee Index payload: the same reads and comparisons as the public
 * /research/state/[code] page, so the PDF and the page state the same figures.
 */

import { getStateFeeIndexes, getStateStats, type StateFeeIndexes } from "@/lib/data-store";
import type { GeoStats } from "@/lib/data-store/geographic";
import { getPublicNationalIndex } from "@/lib/public-stats";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import {
  buildCharterPairs,
  buildComparisons,
  computeStateFindings,
  type CharterPair,
  type StateComparison,
} from "@/app/(public)/research/state/[code]/state-findings";
import type { Finding } from "@/app/(public)/research/findings";
import { assembleRegulatoryContext, type RegulatoryContext } from "./regulatory-context";

export interface StateIndexPayload {
  stateCode: string;
  stateName: string;
  district: number | null;
  districtName: string | null;
  stats: GeoStats;
  verifiedInstitutions: number;
  verifiedBankInstitutions: number;
  verifiedCuInstitutions: number;
  verifiedFees: number;
  comparisons: StateComparison[];
  charterPairs: CharterPair[];
  findings: Finding[];
  regulatory: RegulatoryContext;
}

export async function assembleStateIndex(stateCode: string): Promise<StateIndexPayload> {
  const code = stateCode.toUpperCase();
  const stateName = STATE_NAMES[code];
  if (!stateName) throw new Error(`Unknown state code: ${stateCode}`);

  const district = STATE_TO_DISTRICT[code] ?? null;
  const [stats, indexes, national, regulatory]: [
    GeoStats,
    StateFeeIndexes,
    Awaited<ReturnType<typeof getPublicNationalIndex>>,
    RegulatoryContext,
  ] = await Promise.all([
    getStateStats(code),
    getStateFeeIndexes(code),
    getPublicNationalIndex(),
    assembleRegulatoryContext({ stateCode: code, district }),
  ]);

  const comparisons = buildComparisons(indexes.all, national);
  const charterPairs = buildCharterPairs(
    indexes.bank,
    indexes.credit_union,
    comparisons.map((c) => c.fee_category),
  );

  return {
    stateCode: code,
    stateName,
    district,
    districtName: district ? DISTRICT_NAMES[district] ?? null : null,
    stats,
    verifiedInstitutions: indexes.verified_institutions,
    verifiedBankInstitutions: indexes.verified_bank_institutions,
    verifiedCuInstitutions: indexes.verified_cu_institutions,
    verifiedFees: indexes.verified_fees,
    comparisons,
    charterPairs,
    findings: computeStateFindings(stateName, comparisons, charterPairs),
    regulatory,
  };
}
