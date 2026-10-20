import { sql } from "./connection";
import { getPeerFeeValues, matchesPeerFilters, type PeerFilterSet } from "./fee-index";
import { computeStats } from "./fees";
import { getReportRuleCheck, type ReportRuleCheck } from "./market-readiness";
import { MIN_LOCAL_PEERS_PER_LINE } from "@/lib/custom-report/analysis";
import { OWN_FEE_COVERAGE, PEER_GROUP_ANCHOR } from "@/lib/hamilton/peer-index";
import { isPeerSetVariant } from "@/lib/peer-explorer";

/** The fees the free institution page ranks against peers (value funnel A3). */
export const PEER_RANK_FEE_KEYS = ["overdraft", "monthly_maintenance"] as const;

/** Below this many other institutions publishing a fee, the page shows no rank for it. */
export const MIN_PEERS_FOR_RANK = 5;

export interface PeerRankLine {
  key: (typeof PEER_RANK_FEE_KEYS)[number];
  own: number;
  /** Other institutions in the peer group with a lower, equal and higher fee. */
  lower: number;
  same: number;
  higher: number;
  peers: number;
}

export interface InstitutionPeerRank {
  /** "state" when the state has enough rich peers; otherwise the Fed district, as the report rule does. */
  scope: "state" | "district";
  state_code: string | null;
  fed_district: number | null;
  charter_type: string | null;
  lines: PeerRankLine[];
}

/** Where one fee sits among the other institutions' values. */
export function rankAgainstPeers(own: number, others: number[]): Omit<PeerRankLine, "key" | "own"> {
  let lower = 0;
  let same = 0;
  let higher = 0;
  for (const value of others) {
    if (Math.abs(value - own) < 0.005) same += 1;
    else if (value < own) lower += 1;
    else higher += 1;
  }
  return { lower, same, higher, peers: others.length };
}

/**
 * The institution's overdraft and maintenance fees ranked against same-charter peers, using
 * the paid report's peer rule (state, or Fed district when the state is thin) so the page
 * never shows a comparison the report could not make. Values come from the statistics
 * contract the page's national medians use. Null when the report rule is not met.
 */
export async function getInstitutionPeerRank(institutionId: number): Promise<InstitutionPeerRank | null> {
  return getInstitutionPeerRankForRule(institutionId, await getReportRuleCheck(institutionId));
}

/**
 * The peer group the report rule picks: same charter in the state, or in the Fed district
 * when the state is thin. Null when the rule fails or names no group.
 */
export function peerFiltersForRule(rule: ReportRuleCheck | null): PeerFilterSet | null {
  if (!rule?.passes || !rule.charter_type) return null;
  const filters: PeerFilterSet =
    rule.peerScope === "district" && rule.fed_district !== null
      ? { charter_type: rule.charter_type, fed_districts: [rule.fed_district] }
      : rule.state_code
        ? { charter_type: rule.charter_type, state_code: rule.state_code }
        : { charter_type: rule.charter_type };
  if (!filters.state_code && !filters.fed_districts) return null;
  return filters;
}

/** One institution's value for one ranked fee: [institution id, fee key, amount]. */
export type PeerGroupValue = [institutionId: number, key: PeerRankLine["key"], amount: number];

/**
 * Every institution's ranked-fee values in one peer group. Institutions in the same group
 * share this read, so a crawler walking institution pages costs one read per group, not one
 * per page.
 */
export async function getPeerGroupValues(filters: PeerFilterSet): Promise<PeerGroupValue[]> {
  const [byCategory] = await getPeerFeeValues([filters], [...PEER_RANK_FEE_KEYS]);
  const values: PeerGroupValue[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    for (const value of byCategory?.get(key) ?? []) values.push([value.institution_id, key, value.amount]);
  }
  return values;
}

/**
 * One institution's ranked-fee value with what places it in a peer group:
 * [institution id, fee key, amount, charter, state, Fed district, asset-size tier, distinct prices].
 * The amount is the statistics contract's one value; with more than one price (monthly
 * maintenance) it is the middle of them, so a page never presents it as the fee.
 */
export type PeerRankValue = [
  institutionId: number,
  key: PeerRankLine["key"],
  amount: number,
  charterType: string | null,
  stateCode: string | null,
  fedDistrict: number | null,
  assetTier: string | null,
  /** How many distinct prices the amount is built from; absent reads as one. */
  prices?: number,
];

/**
 * Every institution's ranked-fee values, nationally, for the shared public cache. An
 * institution's value depends only on its own rows, so each peer group is a filter over
 * this list. One entry for every institution page: per-group entries were each re-read
 * after every takedown refresh of the public cache, about 300 reads an hour on Oct 9.
 */
export async function getAllPeerRankValues(): Promise<PeerRankValue[]> {
  const [byCategory] = await getPeerFeeValues([{}], [...PEER_RANK_FEE_KEYS]);
  const ids = new Set<number>();
  for (const key of PEER_RANK_FEE_KEYS) for (const value of byCategory?.get(key) ?? []) ids.add(value.institution_id);
  if (ids.size === 0) return [];
  const places = await sql<{ id: number | string; charter_type: string | null; state_code: string | null; fed_district: number | string | null; asset_size_tier: string | null }[]>`
    SELECT id, charter_type, state_code, fed_district, asset_size_tier FROM institution_sources WHERE id = ANY(${[...ids]}::bigint[])`;
  const placeOf = new Map(places.map((row) => [Number(row.id), row]));
  const values: PeerRankValue[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    for (const value of byCategory?.get(key) ?? []) {
      const place = placeOf.get(value.institution_id);
      values.push([
        value.institution_id,
        key,
        value.amount,
        place?.charter_type ?? null,
        place?.state_code ?? null,
        place?.fed_district === null || place?.fed_district === undefined ? null : Number(place.fed_district),
        place?.asset_size_tier ?? null,
        Math.max(1, new Set((value.fee_records ?? []).map((record) => record.amount)).size),
      ]);
    }
  }
  return values;
}

/** The values of one peer group, filtered from the national list by getPeerFeeValues's own filter. */
export function peerGroupValuesFrom(all: PeerRankValue[], filters: PeerFilterSet): PeerGroupValue[] {
  return all
    .filter(([institutionId, , , charterType, stateCode, fedDistrict, assetTier]) =>
      matchesPeerFilters(
        {
          institution_id: institutionId,
          charter_type: charterType ?? "",
          state_code: stateCode,
          fed_district: fedDistrict,
          asset_size_tier: assetTier ?? null,
        },
        filters,
      ),
    )
    .map(([institutionId, key, amount]) => [institutionId, key, amount]);
}

/** The institution's rank within its peer group's values (see getInstitutionPeerRank). */
export function peerRankFromGroupValues(
  institutionId: number,
  rule: ReportRuleCheck,
  filters: PeerFilterSet,
  values: PeerGroupValue[],
): InstitutionPeerRank | null {
  const lines: PeerRankLine[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    const forKey = values.filter((value) => value[1] === key);
    const own = forKey.find((value) => value[0] === institutionId);
    const others = forKey.filter((value) => value[0] !== institutionId).map((value) => value[2]);
    if (!own || others.length < MIN_PEERS_FOR_RANK) continue;
    lines.push({ key, own: own[2], ...rankAgainstPeers(own[2], others) });
  }
  if (lines.length === 0) return null;
  return {
    scope: filters.fed_districts ? "district" : "state",
    state_code: rule.state_code,
    fed_district: rule.fed_district,
    charter_type: rule.charter_type,
    lines,
  };
}

/** The peer rank once the institution's report rule check is known (see getInstitutionPeerRank). */
export async function getInstitutionPeerRankForRule(
  institutionId: number,
  rule: ReportRuleCheck | null,
): Promise<InstitutionPeerRank | null> {
  const filters = peerFiltersForRule(rule);
  if (!rule || !filters) return null;
  return peerRankFromGroupValues(institutionId, rule, filters, await getPeerGroupValues(filters));
}

/** Below this many peers publishing a fee, a peer set shows "Too few to compare", never a median. */
export const MIN_PEERS_FOR_PEER_SET_MEDIAN = MIN_LOCAL_PEERS_PER_LINE;

/** One peer set a visitor can choose, resolved by peer-sets.ts. Null filters: nobody matches. */
export interface PeerSetChoice {
  key: string;
  label: string;
  filters: PeerFilterSet | null;
}

/** One ranked fee against a chosen peer set. */
export interface PeerSetLine {
  key: PeerRankLine["key"];
  /** The institution's own value; null when its schedule has none. */
  own: number | null;
  /** How many distinct prices `own` is built from; above one, `own` is their middle. */
  ownPrices: number;
  /** Null below MIN_PEERS_FOR_PEER_SET_MEDIAN peers. */
  median: number | null;
  /** Other institutions in the set that publish the fee. */
  peers: number;
  lower: number;
  same: number;
  higher: number;
}

export interface PeerSetComparison {
  key: string;
  label: string;
  lines: PeerSetLine[];
}

/**
 * The institution's ranked fees against one peer set's values, itself left out. Its own
 * values come from the national list, never from the set: a resolved set (metro, regulator,
 * nearest) names only the other institutions, so the choice of peers changes the comparison
 * population and nothing about the institution being compared.
 */
export function comparePeerSet(institutionId: number, choice: PeerSetChoice, all: PeerRankValue[]): PeerSetComparison {
  const values = choice.filters ? peerGroupValuesFrom(all, choice.filters) : [];
  const lines = PEER_RANK_FEE_KEYS.map((key): PeerSetLine => {
    const forKey = values.filter((value) => value[1] === key);
    const ownValue = all.find((value) => value[0] === institutionId && value[1] === key);
    const own = ownValue?.[2] ?? null;
    const ownPrices = ownValue ? (ownValue[7] ?? 1) : 0;
    const others = forKey.filter((value) => value[0] !== institutionId).map((value) => value[2]);
    const enough = others.length >= MIN_PEERS_FOR_PEER_SET_MEDIAN;
    const rank = own !== null && enough ? rankAgainstPeers(own, others) : { lower: 0, same: 0, higher: 0 };
    return { key, own, ownPrices, median: enough ? computeStats(others).median : null, peers: others.length, lower: rank.lower, same: rank.same, higher: rank.higher };
  });
  return { key: choice.key, label: choice.label, lines };
}

/** A peer set is offered only when at least one ranked fee clears the median floor in it. */
export function isComparable(comparison: PeerSetComparison): boolean {
  return comparison.lines.some((line) => line.median !== null);
}

export interface InstitutionPeerSets {
  /** `count`: how many institutions a chosen set names (nearest, metro, regulator); absent for a filter. */
  options: { key: string; label: string; count?: number }[];
  selected: PeerSetComparison;
  /** The selected set as the fee index reads it, for the explorer's read. */
  selectedFilters: PeerFilterSet;
}

/**
 * How many of the institution's own published ranked fees a set can compare (a peer median
 * beside it), and whether that meets the shared default-group rule (#2098): at least
 * OWN_FEE_COVERAGE of its own fees. With no ranked fee of its own, the anchor fee (overdraft)
 * having a median is enough, as in Hamilton.
 */
export function ownFeeCoverage(comparison: PeerSetComparison): { compared: number; fits: boolean } {
  const own = comparison.lines.filter((line) => line.own !== null);
  const compared = own.filter((line) => line.median !== null).length;
  if (own.length === 0) {
    const anchor = comparison.lines.find((line) => line.key === PEER_GROUP_ANCHOR);
    return { compared: 0, fits: anchor?.median != null };
  }
  return { compared, fits: compared >= Math.ceil(OWN_FEE_COVERAGE * own.length) };
}

/**
 * The default set under main's peer-group rule (James, 2026-10-20; #2098, #2046): the first
 * (narrowest) set that compares at least 80% of the institution's own fees. When none does, the
 * rule widens to the set that compares the most of them, so too few publishing peers never pick
 * the default.
 */
function defaultComparable<T extends { comparison: PeerSetComparison }>(comparable: T[]): T {
  const scored = comparable.map((entry) => ({ entry, coverage: ownFeeCoverage(entry.comparison) }));
  const fitting = scored.find(({ coverage }) => coverage.fits);
  if (fitting) return fitting.entry;
  return scored.reduce((best, next) => (next.coverage.compared > best.coverage.compared ? next : best)).entry;
}

/**
 * The peer sets worth offering for one institution beyond the report rule's group (state, or
 * Fed district when the state is thin), which the page's findings and headline table already
 * show, and the one to show: the visitor's choice when it clears the floor, else the default
 * (defaultComparable). Null when none clears the floor.
 */
export function pickPeerSet(
  institutionId: number,
  rule: ReportRuleCheck | null,
  choices: PeerSetChoice[],
  all: PeerRankValue[],
  requested: string | null | undefined,
): InstitutionPeerSets | null {
  const ruleKey = peerFiltersForRule(rule) ? (rule?.peerScope === "district" ? "district" : "state") : null;
  const comparable = choices
    .filter((choice) => choice.key !== ruleKey)
    .map((choice) => ({ choice, comparison: comparePeerSet(institutionId, choice, all) }))
    .filter(({ comparison }) => isComparable(comparison));
  if (comparable.length === 0) return null;
  // A filter on another set's chip (the home metro's banks only) opens only when asked for.
  const defaults = comparable.filter(({ choice }) => !isPeerSetVariant(choice.key));
  const picked =
    comparable.find(({ comparison }) => comparison.key === requested) ?? defaultComparable(defaults.length > 0 ? defaults : comparable);
  return {
    options: comparable.map(({ choice, comparison: { key, label } }) => {
      const ids = choice.filters?.institutionIds;
      return ids ? { key, label, count: ids.length } : { key, label };
    }),
    selected: picked.comparison,
    selectedFilters: picked.choice.filters as PeerFilterSet,
  };
}
