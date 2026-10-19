import { cache } from "react";
import {
  getInstitutionOwnFees,
  getNationalIndexCachedStamped,
  getNationalIndexStamped,
  getPeerIndexStamped,
  getPeerIndexesStamped,
  type IndexEntry,
  type StampedIndex,
} from "@/lib/data-store/fee-index";
import type { DatasetStamp } from "@/lib/dataset-stamp";
import {
  getDefaultPeerSets,
  getSavedPeerSetById,
  type SavedPeerSet,
} from "@/lib/data-store/saved-peers";
import type { InstitutionDetail } from "@/lib/data-store/types";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import { ASSET_TIER_RANGES, chosenInstitutionIds, chosenInstitutionsLabel, peerFilterParts } from "@/lib/peer-filter-words";

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
  /** The data behind `entries`: dataset, live or snapshot and when, method, counting and filters (#1924). */
  stamp: DatasetStamp;
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

export { ASSET_TIER_RANGES };

export function describePeerFilters(filters: HamiltonPeerFilters | null): string {
  if (!filters) return "Verified national index";
  if (filters.label?.trim()) return filters.label.trim();
  // Counted as the stamp counts them: invalid and repeated ids dropped (#2007).
  const chosen = chosenInstitutionIds(filters.institutionIds);
  if (chosen.length) return chosenInstitutionsLabel(chosen.length);
  const parts = peerFilterParts(filters).map((part) => part.label);
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

/** The fee that picks Hamilton's peer group: nearly every institution publishes one (#2046). */
export const PEER_GROUP_ANCHOR = "overdraft";

/**
 * The one rule for a default peer group, shared with every answer (#2046, #2096): the narrowest
 * candidate where at least MIN_PEERS_FOR_POSITION institutions publish the anchor fee.
 */
export function anchorsPeerGroup(entries: Pick<IndexEntry, "fee_category" | "institution_count">[]): boolean {
  return (entries.find((entry) => entry.fee_category === PEER_GROUP_ANCHOR)?.institution_count ?? 0) >= MIN_PEERS_FOR_POSITION;
}

/** Share of the bank's own published fees a default group must let it compare (#2098). */
export const OWN_FEE_COVERAGE = 0.8;

/**
 * The one rule for a default peer group (#2046, #2096, #2098): the narrowest candidate where at
 * least MIN_PEERS_FOR_POSITION other institutions publish 80% of the bank's own published fees.
 * An overdraft-only test picked groups where SchoolsFirst could compare 2 of its 12 fees. A bank
 * with no published fees falls back to the overdraft test. The index counts the bank itself in its
 * own default groups, so a fee it publishes needs one more.
 */
export function coversOwnFees(entries: Pick<IndexEntry, "fee_category" | "institution_count">[], ownCategories: ReadonlySet<string>): boolean {
  if (ownCategories.size === 0) return anchorsPeerGroup(entries);
  const counts = new Map(entries.map((entry) => [entry.fee_category, entry.institution_count]));
  let covered = 0;
  for (const category of ownCategories) if ((counts.get(category) ?? 0) >= MIN_PEERS_FOR_POSITION + 1) covered++;
  return covered >= Math.ceil(OWN_FEE_COVERAGE * ownCategories.size);
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
  // The approved national index is cached (fee_index_cache, refreshed on publish).
  const { entries, stamp } = approvedOnly ? await getNationalIndexCachedStamped() : await getNationalIndexStamped(false);
  return {
    entries,
    label: "Verified national index",
    source: "national",
    filters: null,
    peerSetId: null,
    fallbackReason,
    stamp,
  };
}

/**
 * Every default candidate's index from one query, memoized per request (keyed on the
 * serialized candidates, since cache() compares arguments by identity).
 */
const loadCandidateIndexes = cache(
  (candidatesKey: string, approvedOnly: boolean): Promise<StampedIndex[]> =>
    getPeerIndexesStamped(JSON.parse(candidatesKey) as HamiltonPeerFilters[], approvedOnly),
);

/** The fee categories the bank publishes, which its default group must let it compare (#2098). */
const loadOwnCategories = cache(async (institutionId: number): Promise<Set<string>> => {
  if (!Number.isInteger(institutionId) || institutionId <= 0) return new Set();
  try {
    return new Set((await getInstitutionOwnFees(institutionId)).keys());
  } catch {
    return new Set();
  }
});

/** Per-fee counts for each default candidate, sharing one read per request with the resolver below. */
export async function defaultCandidateEntries(candidates: HamiltonPeerFilters[]): Promise<IndexEntry[][]> {
  return (await loadCandidateIndexes(JSON.stringify(candidates), true)).map((index) => index.entries);
}

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
      const { entries, stamp } = await getPeerIndexStamped(queryFilters(active.filters), approvedOnly);
      if (hasUsablePeerIndex(entries, minUsableCategories)) {
        return {
          entries,
          label: active.label,
          source: "saved-peer-set",
          filters: active.filters,
          peerSetId: String(active.id),
          fallbackReason: null,
          stamp,
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
      const { entries, stamp } = await getPeerIndexStamped(filters, approvedOnly);
      if (hasUsablePeerIndex(entries, minUsableCategories)) {
        return {
          entries,
          label: savedPeerSet.name || describePeerFilters(filters),
          source: "saved-peer-set",
          filters,
          peerSetId,
          fallbackReason: null,
          stamp,
        };
      }
      return resolveNationalIndex(`Saved peer set "${savedPeerSet.name}" is too sparse for this analysis.`, approvedOnly);
    }
  }

  const candidates = buildInstitutionPeerFilterCandidates(params.selectedInstitution);
  const [candidateIndexes, ownCategories] = await Promise.all([
    loadCandidateIndexes(JSON.stringify(candidates), approvedOnly),
    candidates.length && institutionId !== null ? loadOwnCategories(Number(institutionId)) : Promise.resolve(new Set<string>()),
  ]);
  for (const [index, filters] of candidates.entries()) {
    const candidate = candidateIndexes[index];
    const entries = candidate?.entries ?? [];
    // The group rule every answer uses (#2096, #2098), plus the caller's usable-fee floor: a report
    // still needs its three comparable fees.
    if (candidate && coversOwnFees(entries, ownCategories) && hasUsablePeerIndex(entries, minUsableCategories)) {
      return {
        entries,
        label: describePeerFilters(filters),
        source: "selected-institution-default",
        filters,
        peerSetId: null,
        fallbackReason: activeFallbackReason,
        stamp: candidate.stamp,
      };
    }
  }

  return resolveNationalIndex(
    activeFallbackReason ??
      (params.selectedInstitution
        ? "No default peer group has 5 institutions publishing most of this institution's fees, so Hamilton used the verified national index."
        : null),
    approvedOnly,
  );
}
