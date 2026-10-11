/**
 * Deterministic, fee-category aware state/national research for the landing handoff.
 * This is a server-side governed-index adapter, not an authenticated endpoint.
 * Callers must check current-user Pro access and explicit report confirmation first.
 * Data lineage/source-document drill-down and consumer-only audience parity await
 * H06/#986; therefore do not expose the live CTA until preview acceptance.
 */
import {
  getPeerIndexes,
  type IndexEntry,
  type PeerFilterSet,
} from "@/lib/data-store/fee-index";
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
  };
}

/**
 * Uses the existing governed peer-index reader, not a new SQL/statistics engine.
 * State comparisons must use a national reference with the SAME charter filter.
 * The explicit state's identity is never inferred from the current user's account.
 */
export async function loadLandingGeographicResearch(
  rawSelection: unknown,
  reader: (filters: PeerFilterSet[]) => Promise<IndexEntry[][]> = getPeerIndexes,
): Promise<GeographicResearchResult> {
  const selection = parseLandingResearch(rawSelection);
  if (selection.task !== "compare" || selection.scope.kind === "local") {
    throw new LandingResearchError("This research selection needs its dedicated workflow.");
  }
  const charter: PeerFilterSet =
    selection.charter === "all" ? {} : { charter_type: selection.charter };
  const filters: PeerFilterSet[] = selection.scope.kind === "state"
    ? [{ ...charter, state_code: selection.scope.stateCode }, { ...charter }]
    : [{ ...charter }];
  const results = await reader(filters);
  if (results.length !== filters.length || results.some((rows) => !Array.isArray(rows))) {
    throw new LandingResearchError("Market research is temporarily unavailable; no comparison was produced.");
  }
  return buildGeographicResearchResult(selection, results[0], results[1] ?? null);
}
