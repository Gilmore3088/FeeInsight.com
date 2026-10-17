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
import {
  PeerSetError,
  getPeerSubject,
  resolvePeerSet,
  type PeerSetDefinition,
} from "@/lib/data-store/peer-sets";
import { hasSavedPeerDimensions } from "@/lib/peer-set-dimensions";
import { ASSET_TIER_RANGES } from "./asset-tier-ranges";

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

/** True when a saved set uses a dimension beyond charter, asset tier, district, states and chosen institutions. */
export function savedPeerSetHasAdvanced(peerSet: Partial<Pick<SavedPeerSet, "institution_ids" | "advanced">>): boolean {
  return !peerSet.institution_ids?.length && hasSavedPeerDimensions(peerSet.advanced);
}

/** A saved set as the shared peer-set definition (src/lib/data-store/peer-sets.ts). */
export function savedPeerSetDefinition(
  peerSet: Parameters<typeof parseSavedPeerSetFilters>[0] & Pick<SavedPeerSet, "advanced">,
): PeerSetDefinition {
  const basic = parseSavedPeerSetFilters(peerSet);
  const def: PeerSetDefinition = {};
  if (basic.charter_type) def.charter_type = basic.charter_type;
  if (basic.asset_tiers) def.asset_tiers = basic.asset_tiers;
  if (basic.fed_districts) def.fed_districts = basic.fed_districts;
  if (basic.states) def.states = basic.states;
  if (basic.institutionIds) {
    def.institutionIds = basic.institutionIds;
    return def;
  }
  const a = peerSet.advanced;
  if (!a) return def;
  if (a.asset_min !== undefined) def.asset_min = a.asset_min;
  if (a.asset_max !== undefined) def.asset_max = a.asset_max;
  if (a.regulators?.length) def.regulators = [...a.regulators];
  if (a.cu_charter) def.cu_charter = a.cu_charter;
  if (a.holding_company_rssd) def.holding_company_rssd = a.holding_company_rssd;
  if (a.market_code !== undefined) def.market_code = a.market_code;
  if (a.nearest !== undefined) def.nearest = a.nearest;
  return def;
}

export interface SavedPeerSetFilters {
  /** What getPeerIndex / getPeerFeeValues / getPeerGroupCounts read. Null when no peers resolve. */
  filters: HamiltonPeerFilters | null;
  /** The set's name, or a plain-words description of it when unnamed. */
  label: string;
  /** Why the set has no peers right now, in plain words; null when it resolved. */
  problem: string | null;
}

/**
 * One resolution per saved set, subject and request. The subject matters only for the
 * dimensions that read it (closest in assets; every wider set leaves the subject out).
 */
const resolveAdvancedOnce = cache(
  async (definitionKey: string, subjectId: number | null) => {
    const def = JSON.parse(definitionKey) as PeerSetDefinition;
    const subject = subjectId === null ? null : await getPeerSubject(subjectId);
    return resolvePeerSet(def, subject);
  },
);

/**
 * The one path from a saved peer group to the fee readers' filters. A basic set is exactly
 * parseSavedPeerSetFilters (unchanged from before the wider dimensions). A set with any wider
 * dimension is resolved only through resolvePeerSet, which returns the exact institutions; no
 * other peer query runs.
 */
export async function resolveSavedPeerSetFilters(
  peerSet: Parameters<typeof savedPeerSetDefinition>[0] & Pick<SavedPeerSet, "name">,
  subjectInstitutionId: number | null | undefined,
): Promise<SavedPeerSetFilters> {
  const name = peerSet.name?.trim() ?? "";
  if (!savedPeerSetHasAdvanced(peerSet)) {
    const filters = parseSavedPeerSetFilters(peerSet);
    return { filters, label: name || describePeerFilters(filters), problem: null };
  }
  const subjectId = subjectInstitutionId && Number.isInteger(subjectInstitutionId) && subjectInstitutionId > 0
    ? subjectInstitutionId
    : null;
  const def = savedPeerSetDefinition(peerSet);
  try {
    const resolved = await resolveAdvancedOnce(JSON.stringify(def), subjectId);
    const label = name || resolved.label;
    if (!resolved.filters) {
      return { filters: null, label, problem: "None found: no institution meets every part of this peer group." };
    }
    return { filters: cleanFilters(resolved.filters), label, problem: null };
  } catch (error) {
    if (!(error instanceof PeerSetError)) throw error;
    const problem = def.nearest !== undefined && subjectId === null
      ? "Choose a research institution in Settings first. \"Closest in total assets\" is measured against it."
      : error.message;
    return { filters: null, label: name || "Saved peer group", problem };
  }
}

export { ASSET_TIER_RANGES } from "./asset-tier-ranges";

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
 * The saved set that applies from the candidate defaults: the workspace's default for this
 * institution first, else the user's own personal default.
 */
export function chooseDefaultPeerSet(defaults: SavedPeerSet[], institutionId: number | null): SavedPeerSet | null {
  const workspace = institutionId === null
    ? undefined
    : defaults.find((set) => set.is_default && set.institution_id === institutionId);
  const personal = defaults.find((set) => set.is_default && set.institution_id === null);
  return workspace ?? personal ?? null;
}

/**
 * Pick the set that applies from the candidate defaults (see chooseDefaultPeerSet). Its
 * filters are the set's basic columns only: for a set with wider dimensions (asset range,
 * regulator, metro and the rest) charts use getActivePeerSet, which resolves them.
 */
export function pickActivePeerSet(
  defaults: SavedPeerSet[],
  institutionId: number | null,
): ActivePeerSet | null {
  const chosen = chooseDefaultPeerSet(defaults, institutionId);
  return chosen ? toActivePeerSet(chosen) : null;
}

/** The default set resolved for charts, with the reason when it has no peers right now. */
async function loadActivePeerSet(params: {
  userId: string | number | null | undefined;
  institutionId: number | null | undefined;
}): Promise<{ active: ActivePeerSet | null; chosen: SavedPeerSet | null; problem: string | null }> {
  if (params.userId === null || params.userId === undefined || params.userId === "") return { active: null, chosen: null, problem: null };
  const institutionId = params.institutionId && Number.isInteger(params.institutionId) && params.institutionId > 0
    ? params.institutionId
    : null;
  const defaults = await getDefaultPeerSets({ userId: String(params.userId), institutionId });
  const chosen = chooseDefaultPeerSet(defaults, institutionId);
  if (!chosen) return { active: null, chosen: null, problem: null };
  if (!savedPeerSetHasAdvanced(chosen)) return { active: toActivePeerSet(chosen), chosen, problem: null };
  const resolved = await resolveSavedPeerSetFilters(chosen, institutionId);
  if (!resolved.filters) return { active: null, chosen, problem: resolved.problem };
  return { active: { id: chosen.id, name: chosen.name, filters: resolved.filters, label: resolved.label }, chosen, problem: null };
}

/**
 * The peer group every Pro chart and benchmark uses for this user and bank: the workspace's
 * default set (when the user is an active member of that workspace), else the user's own
 * default set. Null when neither exists, with no user (a workspace's choice is never shown
 * to someone outside it), or when a set with wider dimensions has no peers for this bank
 * right now (charts then use automatic peers). A wider set's filters are the exact
 * institutions resolvePeerSet returned.
 */
export async function getActivePeerSet(params: {
  userId: string | number | null | undefined;
  institutionId: number | null | undefined;
}): Promise<ActivePeerSet | null> {
  return (await loadActivePeerSet(params)).active;
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
  /** A default group with no peers: its reason names the group charts use instead, once known. */
  let emptyActiveReason: ((fallbackLabel: string) => string) | null = null;

  if (!peerSetId && userId) {
    // No explicit choice: the workspace's (or the user's) default peer group applies.
    const loaded = await loadActivePeerSet({ userId, institutionId }).catch(() => null);
    const active = loaded?.active ?? null;
    if (!active && loaded?.chosen && loaded.problem) {
      const name = loaded.chosen.name.trim();
      const problem = loaded.problem;
      emptyActiveReason = (fallbackLabel) =>
        `${name ? `Your peer group "${name}"` : "Your peer group"} matches no institutions, so this chart uses ${fallbackLabel} instead. ${problem}`;
    }
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
      const resolved = await resolveSavedPeerSetFilters(savedPeerSet, institutionId);
      const filters = resolved.filters;
      if (!filters) {
        return resolveNationalIndex(`Your peer group "${resolved.label}" matches no institutions, so this chart uses the national index. ${resolved.problem ?? "None found."}`, approvedOnly);
      }
      const entries = await getPeerIndex(filters, approvedOnly);
      if (hasUsablePeerIndex(entries, minUsableCategories)) {
        return {
          entries,
          label: resolved.label,
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
        fallbackReason: emptyActiveReason ? emptyActiveReason(`"${describePeerFilters(filters)}"`) : activeFallbackReason,
      };
    }
  }

  return resolveNationalIndex(
    (emptyActiveReason ? emptyActiveReason("the national index") : null) ??
    activeFallbackReason ??
      (params.selectedInstitution
        ? "Selected-institution peer filters were too sparse, so Hamilton used the verified national index."
        : null),
    approvedOnly,
  );
}
