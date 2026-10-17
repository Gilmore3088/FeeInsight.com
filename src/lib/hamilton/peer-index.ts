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
  resolvePeerInstitutionIds,
  resolvePeerSet,
  type PeerSetDefinition,
} from "@/lib/data-store/peer-sets";
import { AUTOMATIC_PEERS_ID, type EmptyPeerGroup, type PeerGroupSummary } from "./peer-group-copy";
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

/**
 * A saved peer group's members for one research institution: the one answer the peer list,
 * benchmarks, charts and reports all read, so the same group never has two memberships.
 */
export interface SavedPeerGroupMembership {
  /** "ready": at least one institution; "empty": none, and `problem` says why. */
  status: "ready" | "empty";
  /** Exactly the group's institutions, the research institution left out. Empty when "empty". */
  institutionIds: number[];
  /** What getPeerIndex / getPeerFeeValues / getPeerGroupCounts read: these institutions. Null when empty. */
  filters: HamiltonPeerFilters | null;
  /** The set's name, or a plain-words description of it when unnamed. */
  label: string;
  /** Why the set has no institutions right now, in plain words; null when it has some. */
  problem: string | null;
}

/** @deprecated The membership's older name; same shape. */
export type SavedPeerSetFilters = SavedPeerGroupMembership;

const NO_MATCH = "None found: no institution meets all of its filters.";

/**
 * One resolution per saved set, subject and request, only through the shared peer-set module
 * (src/lib/data-store/peer-sets.ts): a set with a wider dimension through resolvePeerSet, a
 * basic one through resolvePeerInstitutionIds, the query resolvePeerSet itself uses.
 */
const resolveMembershipOnce = cache(
  async (definitionKey: string, subjectId: number | null, advanced: boolean): Promise<{ ids: number[]; label: string | null }> => {
    const def = JSON.parse(definitionKey) as PeerSetDefinition;
    if (advanced) {
      const subject = subjectId === null ? null : await getPeerSubject(subjectId);
      const resolved = await resolvePeerSet(def, subject);
      return { ids: resolved.filters?.institutionIds ?? [], label: resolved.label };
    }
    return { ids: await resolvePeerInstitutionIds(def, subjectId === null ? null : { id: subjectId }), label: null };
  },
);

/**
 * The single source of a saved peer group's membership: the exact institutions it holds for
 * this research institution (which is left out), resolved once per request. Every reader gets
 * them as `institutionIds`, so the peer list, the benchmark and the report hold the same
 * institutions; only how many of them publish a given fee differs.
 */
export async function resolveSavedPeerGroupMembership(
  peerSet: Parameters<typeof savedPeerSetDefinition>[0] & Pick<SavedPeerSet, "name">,
  subjectInstitutionId: number | null | undefined,
): Promise<SavedPeerGroupMembership> {
  const name = peerSet.name?.trim() ?? "";
  const subjectId = subjectInstitutionId && Number.isInteger(subjectInstitutionId) && subjectInstitutionId > 0
    ? subjectInstitutionId
    : null;
  const def = savedPeerSetDefinition(peerSet);
  const basicLabel = name || describePeerFilters(parseSavedPeerSetFilters(peerSet));
  const empty = (label: string, problem: string): SavedPeerGroupMembership =>
    ({ status: "empty", institutionIds: [], filters: null, label, problem });
  if (Object.keys(def).length === 0) {
    return empty(name || "Saved peer group", "It has no filters yet. Add at least one in Settings.");
  }
  try {
    const resolved = await resolveMembershipOnce(JSON.stringify(def), subjectId, savedPeerSetHasAdvanced(peerSet));
    const label = name || resolved.label || basicLabel;
    const ids = [...new Set(resolved.ids)];
    if (!ids.length) return empty(label, NO_MATCH);
    return { status: "ready", institutionIds: ids, filters: { institutionIds: ids }, label, problem: null };
  } catch (error) {
    if (!(error instanceof PeerSetError)) throw error;
    const problem = def.nearest !== undefined && subjectId === null
      ? "Choose a research institution in Settings first. \"Closest in total assets\" is measured against it."
      : error.message.replace(/\.?$/, ".");
    return empty(name || "Saved peer group", problem);
  }
}

/** The membership's older name, kept for Settings: the same function. */
export const resolveSavedPeerSetFilters = resolveSavedPeerGroupMembership;

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

/**
 * A saved peer group that applies to every Pro chart and benchmark, resolved for one research
 * institution and holding at least one institution.
 */
export interface ActivePeerSet {
  status: "ready";
  id: number;
  name: string;
  /** The group's members for the readers ({ institutionIds }), no label. */
  filters: HamiltonPeerFilters;
  /** What charts call the group: its name, or a description of its filters when unnamed. */
  label: string;
  /** Institutions in the group, the research institution left out. */
  institutionCount: number;
  /** The research institution the membership was resolved for. */
  institutionId: number | null;
  /**
   * A basic set's stored filters (charter, tiers, districts, states), for a tool that takes
   * filters rather than more than its limit of ids. Null for a set with wider dimensions.
   */
  definition?: HamiltonPeerFilters | null;
}

/** The chosen group: ready with its members, or empty with why. Null when no group is chosen. */
export type ActivePeerSetResult = ActivePeerSet | EmptyPeerGroup;

/** Which saved set is the default, by its stored columns only (no institutions resolved). */
export interface PickedPeerSet {
  id: number;
  name: string;
  /** The set's stored basic filters. Charts never read these; they read getActivePeerSet. */
  filters: HamiltonPeerFilters;
  label: string;
}

function toPickedPeerSet(set: SavedPeerSet): PickedPeerSet {
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

/** Which set is the default (see chooseDefaultPeerSet), without resolving its institutions. */
export function pickActivePeerSet(
  defaults: SavedPeerSet[],
  institutionId: number | null,
): PickedPeerSet | null {
  const chosen = chooseDefaultPeerSet(defaults, institutionId);
  return chosen ? toPickedPeerSet(chosen) : null;
}

/** A positive integer institution id, or null. */
function subjectIdOf(value: number | null | undefined): number | null {
  return value && Number.isInteger(value) && value > 0 ? value : null;
}

/** A saved set resolved for a research institution: ready with its members, or empty with why. */
export async function savedPeerGroupFor(
  set: SavedPeerSet,
  institutionId: number | null,
  institutionName: string | null = null,
): Promise<ActivePeerSetResult> {
  const membership = await resolveSavedPeerGroupMembership(set, institutionId);
  if (membership.status === "empty" || !membership.filters) {
    return {
      status: "empty",
      id: set.id,
      name: set.name,
      label: membership.label,
      institutionId,
      institutionName,
      reason: membership.problem ?? NO_MATCH,
    };
  }
  return {
    status: "ready",
    id: set.id,
    name: set.name,
    filters: membership.filters,
    label: membership.label,
    institutionCount: membership.institutionIds.length,
    institutionId,
    definition: savedPeerSetHasAdvanced(set) || set.institution_ids?.length ? null : parseSavedPeerSetFilters(set),
  };
}

/**
 * The peer group every Pro chart and benchmark uses for this user and bank: the workspace's
 * default set (when the user is an active member of that workspace), else the user's own
 * default set, resolved to its exact institutions. Null when neither exists, or with no user
 * (a workspace's choice is never shown to someone outside it); charts then use automatic
 * peers. A chosen set that matches no institutions comes back `status: "empty"` with the
 * reason: callers show that and never substitute another group.
 */
export async function getActivePeerSet(params: {
  userId: string | number | null | undefined;
  institutionId: number | null | undefined;
  /** The research institution's name, for the empty-group message. */
  institutionName?: string | null;
}): Promise<ActivePeerSetResult | null> {
  if (params.userId === null || params.userId === undefined || params.userId === "") return null;
  const institutionId = subjectIdOf(params.institutionId);
  const defaults = await getDefaultPeerSets({ userId: String(params.userId), institutionId });
  const chosen = chooseDefaultPeerSet(defaults, institutionId);
  return chosen ? savedPeerGroupFor(chosen, institutionId, params.institutionName ?? null) : null;
}

/** The ready group as a summary for captions (see peerGroupCoverageLine). */
export function peerGroupSummary(set: ActivePeerSet, institutionName: string | null): PeerGroupSummary {
  return {
    id: set.id,
    name: set.name,
    label: set.label,
    institutionId: set.institutionId,
    institutionName,
    institutionCount: set.institutionCount,
  };
}

/**
 * The active set as a filter candidate the engine reads. It carries the set's name as `label`,
 * so describePeerFilters (and every chart label built on it) names the group the way the bank
 * named it.
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

export interface HamiltonPeerIndexContext {
  status: "ready";
  entries: IndexEntry[];
  label: string;
  source: HamiltonPeerIndexSource;
  filters: HamiltonPeerFilters | null;
  peerSetId: string | null;
  fallbackReason: string | null;
  /** The saved group behind these entries, with its size; null for automatic peers or national. */
  group: PeerGroupSummary | null;
}

/**
 * A saved group the user picked (or their default) that matches no institutions. Nothing was
 * computed: the caller shows this and lets the user choose another comparison.
 */
export interface HamiltonEmptyPeerIndex extends EmptyPeerGroup {
  entries: [];
  source: "saved-peer-set";
  peerSetId: string | null;
}

export type HamiltonPeerIndexResult = HamiltonPeerIndexContext | HamiltonEmptyPeerIndex;

function emptyPeerIndex(group: EmptyPeerGroup): HamiltonEmptyPeerIndex {
  return { ...group, entries: [], source: "saved-peer-set", peerSetId: group.id === null ? null : String(group.id) };
}

async function resolveNationalIndex(
  fallbackReason: string | null,
  approvedOnly = true,
): Promise<HamiltonPeerIndexContext> {
  return {
    status: "ready",
    // The approved national index is cached (fee_index_cache, refreshed on publish).
    entries: approvedOnly ? await getNationalIndexCached() : await getNationalIndex(false),
    label: "Verified national index",
    source: "national",
    filters: null,
    peerSetId: null,
    fallbackReason,
    group: null,
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

/**
 * The peer index a Pro chart, benchmark or report reads.
 *
 * - peerSetId names a saved group (or, with none, the user's default group applies): its exact
 *   institutions are read, however few publish a given fee. A group that matches no
 *   institutions, or that is not available to this user, comes back `status: "empty"`; nothing
 *   is substituted for it.
 * - peerSetId "auto" (automatic peers, chosen by the user), or no group at all: the research
 *   institution's automatic peers, widened until enough publish, else the national index.
 */
export async function resolveHamiltonPeerIndex(
  params: ResolveHamiltonPeerIndexParams,
): Promise<HamiltonPeerIndexResult> {
  const approvedOnly = params.approvedOnly ?? true;
  const minUsableCategories = params.minUsableCategories ?? 3;
  const userId = params.userId === null || params.userId === undefined ? null : String(params.userId);
  const requested = params.peerSetId?.trim() || null;
  const automatic = requested === AUTOMATIC_PEERS_ID;
  const peerSetId = automatic ? null : requested;
  const institutionId = subjectIdOf(params.institutionId ?? params.selectedInstitution?.id ?? null);
  const institutionName = params.selectedInstitution?.institution_name ?? null;

  let group: ActivePeerSetResult | null = null;
  if (peerSetId && userId) {
    const parsedPeerSetId = Number(peerSetId);
    const savedPeerSet = Number.isInteger(parsedPeerSetId) && parsedPeerSetId > 0
      ? await getSavedPeerSetById(parsedPeerSetId, userId).catch(() => null)
      : null;
    group = savedPeerSet
      ? await savedPeerGroupFor(savedPeerSet, institutionId, institutionName)
      : {
          status: "empty",
          id: Number.isInteger(parsedPeerSetId) && parsedPeerSetId > 0 ? parsedPeerSetId : null,
          name: "",
          label: "Saved peer group",
          institutionId,
          institutionName,
          reason: "It is no longer available to your account. Choose another group.",
        };
  } else if (!automatic && userId) {
    // No explicit choice: the workspace's (or the user's) default peer group applies.
    group = await getActivePeerSet({ userId, institutionId, institutionName });
  }

  if (group?.status === "empty") return emptyPeerIndex(group);
  if (group) {
    // The group's own institutions, however few publish a fee: coverage may differ by fee,
    // membership never does.
    const entries = await getPeerIndex(queryFilters(group.filters), approvedOnly);
    return {
      status: "ready",
      entries,
      label: group.label,
      source: "saved-peer-set",
      filters: group.filters,
      peerSetId: String(group.id),
      fallbackReason: null,
      group: peerGroupSummary(group, institutionName),
    };
  }

  const candidates = buildInstitutionPeerFilterCandidates(params.selectedInstitution);
  const candidateIndexes = await loadCandidateIndexes(JSON.stringify(candidates), approvedOnly);
  for (const [index, filters] of candidates.entries()) {
    const entries = candidateIndexes[index] ?? [];
    if (hasUsablePeerIndex(entries, minUsableCategories)) {
      return {
        status: "ready",
        entries,
        label: describePeerFilters(filters),
        source: "selected-institution-default",
        filters,
        peerSetId: null,
        fallbackReason: null,
        group: null,
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
