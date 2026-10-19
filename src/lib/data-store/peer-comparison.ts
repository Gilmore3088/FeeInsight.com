/**
 * One institution's published dollar fees against a peer group, category by category: the
 * peers' median and middle half, and where the institution's amount falls among them. Values
 * follow the statistics contract (fee-stats.ts): sourced consumer-facing rows only, one value
 * per institution, and no median, percentile or placement below MIN_INSTITUTIONS_FOR_MEDIAN
 * peers. Fees stated as a rate are listed apart and never compared with dollars.
 *
 * The default peers are the institution's own charter type, asset-size tier and Fed district,
 * the narrowest of Hamilton's default peer candidates without a state
 * (buildInstitutionPeerFilterCandidates). A caller may name up to 25 peers instead, or define
 * the group by any dimension of the shared peer-set definition (peer-sets.ts).
 */
import { getInstitutionById } from "./core";
import { getInstitutionOwnFees, getPeerFeeValues, type PeerFeeValue, type PeerFilterSet } from "./fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN, summarizeFees, type MaturityTier } from "./fee-stats";
import { getRateFeesByInstitution } from "./rate-fees";
import { describePeerSet, getPeerSubject, resolvePeerRequest, type PeerSetDefinition, type PeerSetRequest } from "./peer-sets";
import type { PeerMarket } from "./peer-markets";
import { getDisplayName, getFeeFamily } from "@/lib/fee-taxonomy";
import { institutionDisplayName } from "@/lib/institution-display-name";
import type { InstitutionOwnFee, OwnFeeLine } from "@/lib/own-fee";

export { MAX_CHOSEN_PEERS } from "@/lib/peer-set-dimensions";

/** Two amounts within half a cent are the same price. */
const SAME_PRICE_TOLERANCE = 0.005;

export interface PeerCategoryComparison {
  category: string;
  display_name: string;
  family: string | null;
  /** The price the institution's schedule states, in dollars; null when it states several different fees. */
  amount: number | null;
  /** The lowest and highest of its fees in the category (equal when it states one). */
  amount_low: number;
  amount_high: number;
  /** Each of its fees in the category, lowest first. */
  fees: OwnFeeLine[];
  /** Peers with a published dollar amount for this category. */
  peer_count: number;
  peer_median: number | null;
  peer_p25: number | null;
  peer_p75: number | null;
  /** How many peers' amounts are below, equal to and above the institution's; null when it has no single price. */
  peers_lower: number | null;
  peers_same: number | null;
  peers_higher: number | null;
  /**
   * 0 to 100: the share of peers whose amount is lower, counting half of those with the same
   * amount. null below the minimum sample.
   */
  percentile: number | null;
  maturity_tier: MaturityTier;
}

export interface PeerComparisonRateFee {
  category: string | null;
  display_name: string | null;
  fee_name: string;
  rate_percent: number;
  rate_min_amount: number | null;
  rate_max_amount: number | null;
  rate_basis: string | null;
  rate_terms: string;
  source_url: string | null;
}

export interface PeerGroup {
  /** default: same charter, asset tier and Fed district; chosen: named institutions; defined: the caller's dimensions. */
  basis: "default" | "chosen" | "defined";
  label: string;
  /** The dimensions the group was built from, with "same" filled in. Null when chosen. */
  definition: PeerSetDefinition | null;
  /** The metro, when the group is defined by one. */
  market: PeerMarket | null;
  /** The ids asked for, when basis is chosen. */
  peer_ids: number[] | null;
  /** Peers with at least one published dollar fee in the compared categories. */
  peers_with_fees: number;
}

export interface PeerComparison {
  institution: {
    id: number;
    name: string;
    state: string | null;
    charter_type: string | null;
    asset_tier: string | null;
    fed_district: number | null;
  };
  peer_group: PeerGroup;
  min_peers: number;
  categories: PeerCategoryComparison[];
  rate_fees: PeerComparisonRateFee[];
}

/** Mid-rank percentile: share of values below, plus half of those equal, as 0 to 100. */
export function midRankPercentile(amount: number, values: readonly number[]): { lower: number; same: number; higher: number; percentile: number | null } {
  let lower = 0;
  let same = 0;
  let higher = 0;
  for (const value of values) {
    if (Math.abs(value - amount) < SAME_PRICE_TOLERANCE) same++;
    else if (value < amount) lower++;
    else higher++;
  }
  const n = values.length;
  return { lower, same, higher, percentile: n === 0 ? null : Math.round((100 * (lower + same / 2)) / n) };
}

/**
 * One category's comparison from the institution's own fees and each peer's value. Only a
 * single stated price is ranked: a median of several different fees is no price to rank.
 */
export function comparePeerCategory(
  category: string,
  own: Pick<InstitutionOwnFee, "price" | "low" | "high" | "fees">,
  peers: readonly Pick<PeerFeeValue, "institution_id" | "amount">[],
): PeerCategoryComparison {
  const stats = summarizeFees(peers.map((p) => ({ institution_id: p.institution_id, amount: p.amount, fee_category: category })));
  const enough = stats.maturity_tier !== "insufficient";
  const rank = own.price === null ? null : midRankPercentile(own.price, peers.map((p) => p.amount));
  return {
    category,
    display_name: getDisplayName(category),
    family: getFeeFamily(category),
    amount: own.price,
    amount_low: own.low,
    amount_high: own.high,
    fees: own.fees,
    peer_count: stats.institution_count,
    peer_median: enough ? stats.median_amount : null,
    peer_p25: enough ? stats.p25_amount : null,
    peer_p75: enough ? stats.p75_amount : null,
    peers_lower: enough && rank ? rank.lower : null,
    peers_same: enough && rank ? rank.same : null,
    peers_higher: enough && rank ? rank.higher : null,
    percentile: enough && rank ? rank.percentile : null,
    maturity_tier: stats.maturity_tier,
  };
}

/** The default peers: the institution's charter type, asset-size tier and Fed district, where known. */
export function defaultPeerFilters(inst: { charter_type?: string | null; asset_size_tier?: string | null; fed_district?: number | string | null }): PeerFilterSet {
  const filters: PeerFilterSet = {};
  if (inst.charter_type) filters.charter_type = inst.charter_type;
  if (inst.asset_size_tier) filters.asset_tiers = [inst.asset_size_tier];
  const district = Number(inst.fed_district);
  if (Number.isInteger(district) && district >= 1 && district <= 12) filters.fed_districts = [district];
  return filters;
}

/** "Banks with $300M to $1B in assets in Fed district 11 (Dallas)", or "3 chosen institutions". */
export function describePeerGroup(filters: PeerFilterSet): string {
  return describePeerSet(filters);
}

function byFamilyThenName(a: { family: string | null; display_name: string | null }, b: { family: string | null; display_name: string | null }): number {
  return (a.family ?? "").localeCompare(b.family ?? "") || (a.display_name ?? "").localeCompare(b.display_name ?? "");
}

export async function getPeerComparison(
  institutionId: number,
  peerIds: number[] | null,
  request: PeerSetRequest | null = null,
): Promise<PeerComparison | null> {
  const inst = await getInstitutionById(institutionId);
  if (!inst) return null;

  const chosen = peerIds ? peerIds.filter((id) => id !== institutionId) : null;
  let filters: PeerFilterSet | null;
  let label: string;
  let definition: PeerSetDefinition | null = null;
  let market: PeerMarket | null = null;
  if (chosen) {
    filters = { institutionIds: chosen };
    label = chosen.length === 0 ? "No chosen institutions" : describePeerSet(filters);
  } else if (request) {
    const subject = await getPeerSubject(institutionId);
    if (!subject) return null;
    const resolved = await resolvePeerRequest(subject, request);
    ({ filters, label, definition, market } = resolved);
  } else {
    filters = defaultPeerFilters(inst);
    definition = filters;
    label = describePeerSet(filters);
  }
  const own = await getInstitutionOwnFees(institutionId);
  const categories = [...own.keys()];
  const [peerSets, rateFees] = await Promise.all([
    // An empty peer group matches nobody: never read it as "no filter", which is everyone.
    categories.length > 0 && filters && !(chosen && chosen.length === 0)
      ? getPeerFeeValues([filters], categories, institutionId)
      : Promise.resolve([new Map<string, PeerFeeValue[]>()]),
    getRateFeesByInstitution(institutionId, "consumer"),
  ]);
  const peerValues = peerSets[0] ?? new Map<string, PeerFeeValue[]>();

  const publishing = new Set<number>();
  for (const values of peerValues.values()) for (const v of values) publishing.add(v.institution_id);

  const rows = categories
    .map((category) => comparePeerCategory(category, own.get(category)!, peerValues.get(category) ?? []))
    .sort(byFamilyThenName);

  return {
    institution: {
      id: Number(inst.id),
      name: institutionDisplayName(inst.institution_name),
      state: inst.state_code,
      charter_type: inst.charter_type ?? null,
      asset_tier: inst.asset_size_tier,
      fed_district: inst.fed_district == null ? null : Number(inst.fed_district),
    },
    peer_group: {
      basis: chosen ? "chosen" : request ? "defined" : "default",
      label,
      definition,
      market,
      peer_ids: chosen,
      peers_with_fees: publishing.size,
    },
    min_peers: MIN_INSTITUTIONS_FOR_MEDIAN,
    categories: rows,
    rate_fees: rateFees
      .map((fee) => ({
        category: fee.fee_category,
        display_name: fee.fee_category ? getDisplayName(fee.fee_category) : null,
        family: fee.fee_category ? getFeeFamily(fee.fee_category) : null,
        fee_name: fee.fee_name,
        rate_percent: fee.rate_percent,
        rate_min_amount: fee.rate_min_amount == null ? null : Number(fee.rate_min_amount),
        rate_max_amount: fee.rate_max_amount == null ? null : Number(fee.rate_max_amount),
        rate_basis: fee.rate_basis ?? null,
        rate_terms: fee.rate_label,
        source_url: fee.source_url,
      }))
      .sort(byFamilyThenName)
      .map(({ family, ...rest }) => {
        void family;
        return rest;
      }),
  };
}
