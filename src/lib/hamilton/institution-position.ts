/**
 * Where the selected institution's fees sit against its benchmark: the price its schedule
 * states per category against the peer median Hamilton resolves for it. A category where it
 * states several different fees shows their range and no gap: their median is no price. Deterministic, no AI. Priority comes from the size of the
 * gap, never from how much data exists.
 */

import { getInstitutionById } from "@/lib/data-store";
import { getInstitutionOwnFees, type IndexEntry } from "@/lib/data-store/fee-index";
import type { InstitutionOwnFee, OwnFeeLine } from "@/lib/own-fee";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { resolveHamiltonPeerIndex, type HamiltonPeerIndexSource } from "./peer-index";

export type GapPriority = "high" | "medium" | "low";

/** A gap of 25% or more from the benchmark median is high priority; 10% or more is medium. */
export const HIGH_PRIORITY_GAP_PCT = 25;
export const MEDIUM_PRIORITY_GAP_PCT = 10;
const MAX_POSITION_ROWS = 8;

export interface InstitutionPositionEntry {
  feeCategory: string;
  displayName: string;
  /** The price the schedule states; null when it states several different fees in the category. */
  yourAmount: number | null;
  /** The lowest and highest of its fees in the category (equal when it states one). */
  yourLow: number;
  yourHigh: number;
  /** Each of its fees in the category, lowest first. */
  yourFees: OwnFeeLine[];
  benchmarkMedian: number;
  /** The benchmark's middle half (25th to 75th percentile); null when too few institutions. */
  benchmarkP25: number | null;
  benchmarkP75: number | null;
  benchmarkCount: number;
  maturityTier: IndexEntry["maturity_tier"];
  /** Null when the institution has no single price for the category. */
  gapAmount: number | null;
  /** Percent above (+) or below (-) the benchmark median; null when the median is $0 or there is no single price. */
  gapPct: number | null;
}

export interface InstitutionPositioning {
  institutionId: number;
  institutionName: string;
  benchmarkLabel: string;
  benchmarkSource: HamiltonPeerIndexSource;
  /** Where the institution is, for the state and Fed district context around its fees. */
  stateCode: string | null;
  fedDistrict: number | null;
  /** Categories where the institution has a fee and the benchmark has a median, largest gap first. */
  entries: InstitutionPositionEntry[];
  /** Categories with a fee of the institution's own, benchmarked or not. */
  ownFeeCount: number;
  topGap: InstitutionPositionEntry | null;
  priority: GapPriority | null;
}

function displayNameFor(category: string): string {
  return DISPLAY_NAMES[category] ?? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function gapPriority(gapPct: number | null): GapPriority {
  if (gapPct === null) return "low";
  const size = Math.abs(gapPct);
  if (size >= HIGH_PRIORITY_GAP_PCT) return "high";
  if (size >= MEDIUM_PRIORITY_GAP_PCT) return "medium";
  return "low";
}

function gapSize(entry: InstitutionPositionEntry): number {
  return entry.gapPct === null ? 0 : Math.abs(entry.gapPct);
}

/** The largest gaps, but never without overdraft (Hamilton's flagship fee) when the bank publishes it. */
function keepOverdraft(entries: InstitutionPositionEntry[], max: number): InstitutionPositionEntry[] {
  const top = entries.slice(0, max);
  const overdraft = entries.find((e) => e.feeCategory === "overdraft");
  if (!overdraft || top.includes(overdraft)) return top;
  return [...top.slice(0, max - 1), overdraft];
}

export function buildInstitutionPositioning(params: {
  institutionId: number;
  institutionName: string;
  benchmarkLabel: string;
  benchmarkSource: HamiltonPeerIndexSource;
  stateCode?: string | null;
  fedDistrict?: number | null;
  benchmark: (Pick<IndexEntry, "fee_category" | "median_amount" | "institution_count" | "maturity_tier">
    & Partial<Pick<IndexEntry, "p25_amount" | "p75_amount">>)[];
  ownFees: Map<string, Pick<InstitutionOwnFee, "price" | "low" | "high" | "fees">>;
}): InstitutionPositioning {
  const benchmarkByCategory = new Map(params.benchmark.map((entry) => [entry.fee_category, entry]));
  const entries: InstitutionPositionEntry[] = [];
  for (const [category, own] of params.ownFees) {
    const benchmark = benchmarkByCategory.get(category);
    if (!benchmark || benchmark.median_amount === null) continue;
    const median = benchmark.median_amount;
    const yourAmount = own.price;
    const gapAmount = yourAmount === null ? null : yourAmount - median;
    entries.push({
      feeCategory: category,
      displayName: displayNameFor(category),
      yourAmount,
      yourLow: own.low,
      yourHigh: own.high,
      yourFees: own.fees,
      benchmarkMedian: median,
      benchmarkP25: benchmark.p25_amount ?? null,
      benchmarkP75: benchmark.p75_amount ?? null,
      benchmarkCount: benchmark.institution_count,
      maturityTier: benchmark.maturity_tier,
      gapAmount,
      gapPct: gapAmount === null || median === 0 ? null : (gapAmount / median) * 100,
    });
  }
  entries.sort((a, b) => gapSize(b) - gapSize(a) || a.displayName.localeCompare(b.displayName));
  const topGap = entries.find((entry) => entry.gapAmount !== null) ?? null;
  return {
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    benchmarkLabel: params.benchmarkLabel,
    benchmarkSource: params.benchmarkSource,
    stateCode: params.stateCode ?? null,
    fedDistrict: params.fedDistrict ?? null,
    entries: keepOverdraft(entries, MAX_POSITION_ROWS),
    ownFeeCount: params.ownFees.size,
    topGap,
    priority: topGap ? gapPriority(topGap.gapPct) : null,
  };
}

/**
 * The selected institution's positioning, or null when the institution doesn't exist. With a
 * userId, it follows the workspace's (or the user's) default peer group.
 */
export async function fetchInstitutionPositioning(
  institutionId: number,
  userId?: string | number | null,
): Promise<InstitutionPositioning | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const [peerIndex, ownFees] = await Promise.all([
    resolveHamiltonPeerIndex({ selectedInstitution: institution, institutionId, userId: userId ?? null }),
    getInstitutionOwnFees(institutionId),
  ]);
  return buildInstitutionPositioning({
    institutionId,
    institutionName: institution.institution_name,
    benchmarkLabel: peerIndex.label,
    benchmarkSource: peerIndex.source,
    stateCode: institution.state_code ?? null,
    fedDistrict: institution.fed_district ?? null,
    benchmark: peerIndex.entries,
    ownFees,
  });
}
