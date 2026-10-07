import { cache } from "react";
import {
  getNationalIndex,
  getNationalIndexCached,
  getPeerIndex,
  getPeerIndexes,
  type IndexEntry,
} from "@/lib/data-store/fee-index";
import {
  getDefaultPeerSets,
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
  /** Any of these states. */
  states?: string[];
  /** Hand-picked peers: when set, the peers are exactly these institutions. */
  institutionIds?: number[];
  /**
   * Display only: the name charts show for this group (a saved peer group's name).
   * Never filters anything; describePeerFilters returns it when present.
   */
  label?: string;
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
  /** The workspace whose default peer group applies; defaults to selectedInstitution.id. */
  institutionId?: number | null;
  selectedInstitution?: (Pick<
    InstitutionDetail,
    "institution_name" | "state_code" | "charter_type" | "asset_size_tier" | "fed_district"
  > & { id?: number | null }) | null;
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
  const states = [...new Set((filters.states ?? []).map((st) => st.trim().toUpperCase()).filter(Boolean))];
  if (states.length) cleaned.states = states;
  const ids = [...new Set((filters.institutionIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length) cleaned.institutionIds = ids;
  if (filters.label?.trim()) cleaned.label = filters.label.trim();
  return cleaned;
}

function filtersKey(filters: HamiltonPeerFilters): string {
  const clean = cleanFilters(filters);
  return JSON.stringify({
    charter_type: clean.charter_type ?? "",
    state_code: clean.state_code ?? "",
    asset_tiers: clean.asset_tiers ?? [],
    fed_districts: clean.fed_districts ?? [],
    states: clean.states ?? [],
    institutionIds: clean.institutionIds ?? [],
  });
}

export function parseSavedPeerSetFilters(
  peerSet: Pick<SavedPeerSet, "tiers" | "districts" | "charter_type"> &
    Partial<Pick<SavedPeerSet, "states" | "institution_ids">>,
): HamiltonPeerFilters {
  return cleanFilters({
    charter_type: peerSet.charter_type ?? undefined,
    asset_tiers: parseCsv(peerSet.tiers),
    fed_districts: parseDistrictCsv(peerSet.districts),
    states: peerSet.states ?? undefined,
    institutionIds: peerSet.institution_ids ?? undefined,
  });
}

/** Asset ranges for both tier vocabularies (institution segments and FDIC tiers). */
export const ASSET_TIER_RANGES: Record<string, string> = {
  community_small: "under $300M",
  community_mid: "$300M to $1B",
  community_large: "$1B to $10B",
  regional: "$10B to $50B",
  large_regional: "$50B to $250B",
  super_regional: "over $250B",
  micro: "under $100M",
  community: "$100M to $1B",
  midsize: "$1B to $10B",
  mega: "over $250B",
};

export function describePeerFilters(filters: HamiltonPeerFilters | null): string {
  if (!filters) return "Verified national index";
  if (filters.label?.trim()) return filters.label.trim();
  if (filters.institutionIds?.length) {
    const n = filters.institutionIds.length;
    return `${n} chosen ${n === 1 ? "institution" : "institutions"}`;
  }
  const parts: string[] = [];
  if (filters.state_code) parts.push(filters.state_code);
  if (filters.states?.length) parts.push(filters.states.join("/"));
  if (filters.charter_type) parts.push(filters.charter_type.replace(/_/g, " "));
  if (filters.asset_tiers?.length) {
    parts.push(filters.asset_tiers.map((tier) => ASSET_TIER_RANGES[tier] ?? tier.replace(/_/g, " ")).join(" or "));
  }
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

/** A saved peer group that applies to every Pro chart and benchmark. */
export interface ActivePeerSet {
  id: number;
  name: string;
  /** The group's filters, ready for getPeerIndex / getPeerFeeValues (no label). */
  filters: HamiltonPeerFilters;
  /** What charts call the group: its name, or a description of its filters when unnamed. */
  label: string;
}

function toActivePeerSet(set: SavedPeerSet): ActivePeerSet {
  const filters = parseSavedPeerSetFilters(set);
  return { id: set.id, name: set.name, filters, label: set.name.trim() || describePeerFilters(filters) };
}

/**
 * Pick the set that applies from the candidate defaults: the workspace's default for this
 * institution first, else the user's own personal default.
 */
export function pickActivePeerSet(
  defaults: SavedPeerSet[],
  institutionId: number | null,
): ActivePeerSet | null {
  const workspace = institutionId === null
    ? undefined
    : defaults.find((set) => set.is_default && set.institution_id === institutionId);
  const personal = defaults.find((set) => set.is_default && set.institution_id === null);
  const chosen = workspace ?? personal;
  return chosen ? toActivePeerSet(chosen) : null;
}

/**
 * The peer group every Pro chart and benchmark uses for this user and bank: the workspace's
 * default set (when the user is an active member of that workspace), else the user's own
 * default set. Null when neither exists, or with no user (a workspace's choice is never shown
 * to someone outside it).
 */
export async function getActivePeerSet(params: {
  userId: string | number | null | undefined;
  institutionId: number | null | undefined;
}): Promise<ActivePeerSet | null> {
  if (params.userId === null || params.userId === undefined || params.userId === "") return null;
  const institutionId = params.institutionId && Number.isInteger(params.institutionId) && params.institutionId > 0
    ? params.institutionId
    : null;
  const defaults = await getDefaultPeerSets({ userId: String(params.userId), institutionId });
  return pickActivePeerSet(defaults, institutionId);
}

/**
 * The active set as a filter candidate the engine can put first in its candidate list. It
 * carries the set's name as `label`, so describePeerFilters (and every chart label built on it)
 * names the group the way the bank named it.
 */
export function peerSetCandidate(set: Pick<ActivePeerSet, "filters" | "label">): HamiltonPeerFilters {
  return { ...set.filters, label: set.label };
}

/** The filters without the display-only label, for the data readers. */
function queryFilters(filters: HamiltonPeerFilters): HamiltonPeerFilters {
  const rest = { ...filters };
  delete rest.label;
  return rest;
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
  const institutionId = params.institutionId ?? params.selectedInstitution?.id ?? null;
  let activeFallbackReason: string | null = null;

  if (!peerSetId && userId) {
    // No explicit choice: the workspace's (or the user's) default peer group applies.
    const active = await getActivePeerSet({ userId, institutionId }).catch(() => null);
    if (active) {
      const entries = await getPeerIndex(queryFilters(active.filters), approvedOnly);
      if (hasUsablePeerIndex(entries, minUsableCategories)) {
        return {
          entries,
          label: active.label,
          source: "saved-peer-set",
          filters: active.filters,
          peerSetId: String(active.id),
          fallbackReason: null,
        };
      }
      activeFallbackReason = `Your peer group "${active.label}" has too few institutions publishing these fees, so Hamilton widened to the next group.`;
    }
  }

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
        fallbackReason: activeFallbackReason,
      };
    }
  }

  return resolveNationalIndex(
    activeFallbackReason ??
      (params.selectedInstitution
        ? "Selected-institution peer filters were too sparse, so Hamilton used the verified national index."
        : null),
    approvedOnly,
  );
}
