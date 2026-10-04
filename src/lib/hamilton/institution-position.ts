/**
 * Where the selected institution's fees sit against its benchmark: its own value per
 * category (the statistics contract's per-institution median) against the peer median
 * Hamilton resolves for it. Deterministic, no AI. Priority comes from the size of the
 * gap, never from how much data exists.
 */

import { getInstitutionById } from "@/lib/data-store";
import { getInstitutionFeeValues, type IndexEntry } from "@/lib/data-store/fee-index";
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
  yourAmount: number;
  benchmarkMedian: number;
  benchmarkCount: number;
  maturityTier: IndexEntry["maturity_tier"];
  gapAmount: number;
  /** Percent above (+) or below (-) the benchmark median; null when the median is $0. */
  gapPct: number | null;
}

export interface InstitutionPositioning {
  institutionId: number;
  institutionName: string;
  benchmarkLabel: string;
  benchmarkSource: HamiltonPeerIndexSource;
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

export function buildInstitutionPositioning(params: {
  institutionId: number;
  institutionName: string;
  benchmarkLabel: string;
  benchmarkSource: HamiltonPeerIndexSource;
  benchmark: Pick<IndexEntry, "fee_category" | "median_amount" | "institution_count" | "maturity_tier">[];
  ownValues: Map<string, number>;
}): InstitutionPositioning {
  const benchmarkByCategory = new Map(params.benchmark.map((entry) => [entry.fee_category, entry]));
  const entries: InstitutionPositionEntry[] = [];
  for (const [category, yourAmount] of params.ownValues) {
    const benchmark = benchmarkByCategory.get(category);
    if (!benchmark || benchmark.median_amount === null) continue;
    const median = benchmark.median_amount;
    const gapAmount = yourAmount - median;
    entries.push({
      feeCategory: category,
      displayName: displayNameFor(category),
      yourAmount,
      benchmarkMedian: median,
      benchmarkCount: benchmark.institution_count,
      maturityTier: benchmark.maturity_tier,
      gapAmount,
      gapPct: median === 0 ? null : (gapAmount / median) * 100,
    });
  }
  entries.sort((a, b) => gapSize(b) - gapSize(a) || a.displayName.localeCompare(b.displayName));
  const topGap = entries[0] ?? null;
  return {
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    benchmarkLabel: params.benchmarkLabel,
    benchmarkSource: params.benchmarkSource,
    entries: entries.slice(0, MAX_POSITION_ROWS),
    ownFeeCount: params.ownValues.size,
    topGap,
    priority: topGap ? gapPriority(topGap.gapPct) : null,
  };
}

/** The selected institution's positioning, or null when the institution doesn't exist. */
export async function fetchInstitutionPositioning(institutionId: number): Promise<InstitutionPositioning | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const [peerIndex, ownValues] = await Promise.all([
    resolveHamiltonPeerIndex({ selectedInstitution: institution }),
    getInstitutionFeeValues(institutionId),
  ]);
  return buildInstitutionPositioning({
    institutionId,
    institutionName: institution.institution_name,
    benchmarkLabel: peerIndex.label,
    benchmarkSource: peerIndex.source,
    benchmark: peerIndex.entries,
    ownValues,
  });
}
