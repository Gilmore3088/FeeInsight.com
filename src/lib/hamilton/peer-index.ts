import { cache } from "react";
import {
  getNationalIndex,
  getNationalIndexCached,
  getPeerIndex,
  getPeerIndexes,
  type IndexEntry,
} from "@/lib/data-store/fee-index";
import {
  getSavedPeerSetById,
  type SavedPeerSet,
} from "@/lib/data-store/saved-peers";
import type { InstitutionDetail } from "@/lib/data-store/types";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";

export interface HamiltonPeerFilters {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  state_code?: string;
}

export type HamiltonPeerIndexSource =
  | "saved-peer-set"
  | "selected-institution-default"
  | "national";

export interface HamiltonPeerIndexContext {
  entries: IndexEntry[];
  label: string;
  source: HamiltonPeerIndexSource;
  filters: HamiltonPeerFilters | null;
  peerSetId: string | null;
  fallbackReason: string | null;
}

interface ResolveHamiltonPeerIndexParams {
  userId?: string | number | null;
  peerSetId?: string | null;
  selectedInstitution?: Pick<
    InstitutionDetail,
    "institution_name" | "state_code" | "charter_type" | "asset_size_tier" | "fed_district"
  > | null;
  approvedOnly?: boolean;
  minUsableCategories?: number;
}

function parseCsv(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseDistrictCsv(value: string | null): number[] {
  return parseCsv(value)
    .map((part) => Number(part))
    .filter((district) => Number.isInteger(district) && district >= 1 && district <= 12);
}

function cleanFilters(filters: HamiltonPeerFilters): HamiltonPeerFilters {
  const cleaned: HamiltonPeerFilters = {};
  if (filters.charter_type?.trim()) cleaned.charter_type = filters.charter_type.trim();
  if (filters.state_code?.trim()) cleaned.state_code = filters.state_code.trim().toUpperCase();
  if (filters.asset_tiers?.length) cleaned.asset_tiers = [...new Set(filters.asset_tiers.filter(Boolean))];
  if (filters.fed_districts?.length) cleaned.fed_districts = [...new Set(filters.fed_districts)];
  return cleaned;
}

function filtersKey(filters: HamiltonPeerFilters): string {
  const clean = cleanFilters(filters);
  return JSON.stringify({
    charter_type: clean.charter_type ?? "",
    state_code: clean.state_code ?? "",
    asset_tiers: clean.asset_tiers ?? [],
    fed_districts: clean.fed_districts ?? [],
  });
}

export function parseSavedPeerSetFilters(peerSet: Pick<SavedPeerSet, "tiers" | "districts" | "charter_type">): HamiltonPeerFilters {
  return cleanFilters({
    charter_type: peerSet.charter_type ?? undefined,
    asset_tiers: parseCsv(peerSet.tiers),
    fed_districts: parseDistrictCsv(peerSet.districts),
  });
}

export function describePeerFilters(filters: HamiltonPeerFilters | null): string {
  if (!filters) return "Verified national index";
  const parts: string[] = [];
  if (filters.state_code) parts.push(filters.state_code);
  if (filters.charter_type) parts.push(filters.charter_type.replace(/_/g, " "));
  if (filters.asset_tiers?.length) parts.push(filters.asset_tiers.join("/"));
  if (filters.fed_districts?.length) {
    parts.push(`Fed district ${filters.fed_districts.join("/")}`);
  }
  return parts.length > 0 ? `${parts.join(" · ")} peers` : "Configured peer set";
}

export function buildInstitutionPeerFilterCandidates(
  institution: ResolveHamiltonPeerIndexParams["selectedInstitution"],
): HamiltonPeerFilters[] {
  if (!institution) return [];

  const state = institution.state_code ?? undefined;
  const charter = institution.charter_type ?? undefined;
  const tier = institution.asset_size_tier ? [institution.asset_size_tier] : undefined;
  const district = institution.fed_district ? [institution.fed_district] : undefined;
  const rawCandidates: HamiltonPeerFilters[] = [
    { state_code: state, charter_type: charter, asset_tiers: tier, fed_districts: district },
    { state_code: state, charter_type: charter, asset_tiers: tier },
    { charter_type: charter, asset_tiers: tier, fed_districts: district },
    { charter_type: charter, asset_tiers: tier },
    { state_code: state, charter_type: charter },
    { charter_type: charter },
    { state_code: state },
  ];

  const seen = new Set<string>();
  return rawCandidates
    .map(cleanFilters)
    .filter((filters) => Object.keys(filters).length > 0)
    .filter((filters) => {
      const key = filtersKey(filters);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function hasUsablePeerIndex(
  entries: Pick<IndexEntry, "median_amount" | "institution_count">[],
  minUsableCategories = 3,
): boolean {
  return entries.filter(
    (entry) => entry.median_amount !== null && entry.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN,
  ).length >= minUsableCategories;
}

async function resolveNationalIndex(
  fallbackReason: string | null,
  approvedOnly = true,
): Promise<HamiltonPeerIndexContext> {
  return {
    // The approved national index is cached (fee_index_cache, refreshed on publish).
    entries: approvedOnly ? await getNationalIndexCached() : await getNationalIndex(false),
    label: "Verified national index",
    source: "national",
    filters: null,
    peerSetId: null,
    fallbackReason,
  };
}

/**
 * Every default candidate's index from one query, memoized per request (keyed on the
 * serialized candidates, since cache() compares arguments by identity).
 */
const loadCandidateIndexes = cache(
  (candidatesKey: string, approvedOnly: boolean): Promise<IndexEntry[][]> =>
    getPeerIndexes(JSON.parse(candidatesKey) as HamiltonPeerFilters[], approvedOnly),
);

export async function resolveHamiltonPeerIndex(
  params: ResolveHamiltonPeerIndexParams,
): Promise<HamiltonPeerIndexContext> {
  const approvedOnly = params.approvedOnly ?? true;
  const minUsableCategories = params.minUsableCategories ?? 3;
  const userId = params.userId === null || params.userId === undefined ? null : String(params.userId);
  const peerSetId = params.peerSetId?.trim() || null;

  if (peerSetId && userId) {
    const parsedPeerSetId = Number(peerSetId);
    const savedPeerSet = Number.isInteger(parsedPeerSetId) && parsedPeerSetId > 0
      ? await getSavedPeerSetById(parsedPeerSetId, userId).catch(() => null)
      : null;
    if (savedPeerSet) {
      const filters = parseSavedPeerSetFilters(savedPeerSet);
      const entries = await getPeerIndex(filters, approvedOnly);
      if (hasUsablePeerIndex(entries, minUsableCategories)) {
        return {
          entries,
          label: savedPeerSet.name || describePeerFilters(filters),
          source: "saved-peer-set",
          filters,
          peerSetId,
          fallbackReason: null,
        };
      }
      return resolveNationalIndex(`Saved peer set "${savedPeerSet.name}" is too sparse for this analysis.`, approvedOnly);
    }
  }

  const candidates = buildInstitutionPeerFilterCandidates(params.selectedInstitution);
  const candidateIndexes = await loadCandidateIndexes(JSON.stringify(candidates), approvedOnly);
  for (const [index, filters] of candidates.entries()) {
    const entries = candidateIndexes[index] ?? [];
    if (hasUsablePeerIndex(entries, minUsableCategories)) {
      return {
        entries,
        label: describePeerFilters(filters),
        source: "selected-institution-default",
        filters,
        peerSetId: null,
        fallbackReason: null,
      };
    }
  }

  return resolveNationalIndex(
    params.selectedInstitution
      ? "Selected-institution peer filters were too sparse, so Hamilton used the verified national index."
      : null,
    approvedOnly,
  );
}
