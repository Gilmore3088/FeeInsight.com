/**
 * Deterministic, fee-category aware state/national research for the landing handoff.
 * This is a server-side governed-index adapter, not an authenticated endpoint.
 * Callers must check current-user Pro access and explicit report confirmation first.
 * Data lineage/source-document drill-down and consumer-only audience parity await
 * H06/#986; therefore do not expose the live CTA until preview acceptance.
 */
import {
  getPeerIndexesStamped,
  type IndexEntry,
  type PeerFilterSet,
  type StampedIndex,
} from "@/lib/data-store/fee-index";
import type { DatasetStamp } from "@/lib/dataset-stamp";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import {
  LandingResearchError,
  parseLandingResearch,
  type LandingResearchHandoff,
} from "./landing-research-handoff";

export interface GeographicFeeMeasure {
  /** No measure is issued for thin, missing or invalid cohorts. $0 remains valid. */
  median: number | null;
  p25: number | null;
  p75: number | null;
  institutions: number;
  observations: number;
  lastUpdated: string | null;
  status: "available" | "insufficient" | "not_observed";
}
export interface GeographicFeeComparison {
  category: string;
  selected: GeographicFeeMeasure;
  /** Same-charter national reference for a state; absent for national-only research. */
  national: GeographicFeeMeasure | null;
  /** Selected minus national dollars, only for two eligible, observed medians. */
  difference: number | null;
}
export interface GeographicResearchResult {
  scope: LandingResearchHandoff["scope"];
  charter: LandingResearchHandoff["charter"];
  categories: string[];
  comparisons: GeographicFeeComparison[];
  method: "published_fee_index_by_institution";
  source: "published_fee_catalog";
  /** The data behind the selected scope and its national reference (#1924); absent from readers without stamps. */
  stamps?: { selected: DatasetStamp; national: DatasetStamp | null };
}

export function measureFromIndex(row: IndexEntry | undefined): GeographicFeeMeasure {
  const count = row && Number.isFinite(row.institution_count) && row.institution_count >= 0
    ? row.institution_count
    : 0;
  const observations = row && Number.isFinite(row.observation_count) && row.observation_count >= 0
    ? row.observation_count
    : 0;
  const status: GeographicFeeMeasure["status"] = !row || count === 0
    ? "not_observed"
    : count < MIN_INSTITUTIONS_FOR_MEDIAN ||
        row.median_amount === null ||
        !Number.isFinite(Number(row.median_amount)) ||
        Number(row.median_amount) < 0
      ? "insufficient"
      : "available";
  const figure = (value: number | null | undefined): number | null =>
    status === "available" && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : null;
  return {
    median: figure(row?.median_amount),
    p25: figure(row?.p25_amount),
    p75: figure(row?.p75_amount),
    institutions: count,
    observations,
    lastUpdated: row?.last_updated ?? null,
    status,
  };
}

export function buildGeographicResearchResult(
  selection: LandingResearchHandoff,
  selectedIndex: IndexEntry[],
  referenceIndex: IndexEntry[] | null,
  stamps?: GeographicResearchResult["stamps"],
): GeographicResearchResult {
  if (selection.task !== "compare" || selection.scope.kind === "local") {
    throw new LandingResearchError("Use the dedicated local-market or board-report workflow.");
  }
  const selectedBy = new Map(selectedIndex.map((row) => [row.fee_category, row]));
  const nationalBy = new Map(referenceIndex?.map((row) => [row.fee_category, row]) ?? []);
  const comparisons = selection.categories.map((category): GeographicFeeComparison => {
    const selected = measureFromIndex(selectedBy.get(category));
    const national = selection.scope.kind === "state"
      ? measureFromIndex(nationalBy.get(category))
      : null;
    return {
      category,
      selected,
      national,
      difference: national?.median !== null && national?.median !== undefined && selected.median !== null
        ? Math.round((selected.median - national.median) * 100) / 100
        : null,
    };
  });
  return {
    scope: selection.scope,
    charter: selection.charter,
    categories: [...selection.categories],
    comparisons,
    method: "published_fee_index_by_institution",
    source: "published_fee_catalog",
    ...(stamps ? { stamps } : {}),
  };
}

/**
 * Uses the existing governed peer-index reader, not a new SQL/statistics engine.
 * State comparisons must use a national reference with the SAME charter filter.
 * The explicit state's identity is never inferred from the current user's account.
 */
export async function loadLandingGeographicResearch(
  rawSelection: unknown,
  reader: (filters: PeerFilterSet[]) => Promise<(IndexEntry[] | StampedIndex)[]> = getPeerIndexesStamped,
  /** Asset tiers applied to both the selected scope and its national reference, so they stay comparable. */
  assetTiers: readonly string[] | null = null,
): Promise<GeographicResearchResult> {
  const selection = parseLandingResearch(rawSelection);
  if (selection.task !== "compare" || selection.scope.kind === "local") {
    throw new LandingResearchError("This research selection needs its dedicated workflow.");
  }
  const charter: PeerFilterSet = {
    ...(selection.charter === "all" ? {} : { charter_type: selection.charter }),
    ...(assetTiers?.length ? { asset_tiers: [...assetTiers] } : {}),
  };
  const filters: PeerFilterSet[] = selection.scope.kind === "state"
    ? [{ ...charter, state_code: selection.scope.stateCode }, { ...charter }]
    : [{ ...charter }];
  const read = await reader(filters);
  const results = read.map((r) => (Array.isArray(r) ? { entries: r, stamp: null } : r));
  if (results.length !== filters.length || results.some((r) => !r || !Array.isArray(r.entries))) {
    throw new LandingResearchError("Market research is temporarily unavailable; no comparison was produced.");
  }
  const [selected, national] = results;
  const stamps = selected.stamp ? { selected: selected.stamp, national: national?.stamp ?? null } : undefined;
  return buildGeographicResearchResult(selection, selected.entries, national?.entries ?? null, stamps);
}
