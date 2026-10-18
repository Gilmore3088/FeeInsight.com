/**
 * The public peer explorer's read (institution page, #peers): one peer set's institutions with
 * their names, total assets and headquarters, and each one's value for the explorer's fees under
 * the statistics contract, read through getPeerFeeValues like every other peer figure. The set's
 * members come from peer-sets.ts, so a group is never computed two ways.
 */
import { sql } from "./connection";
import { getPeerFeeValues, peerInstitutionIds, type PeerFeeValue, type PeerFilterSet } from "./fee-index";
import { computeStats } from "./fees";
import { getPeerSubject, resolvePeerInstitutionIds } from "./peer-sets";
import { getHomeMarket, getMarketBranchCities, getMarketPresence } from "./peer-markets";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "./peer-fee-rank";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { displayCity } from "@/lib/format";
import { productNameFromFeeName } from "@/lib/agents/knox/lineup";
import {
  capPeerExplorerSet,
  EXPLORER_FEE_KEYS,
  PEER_EXPLORER_MAX_SHOWN,
  type ExplorerFee,
  type ExplorerFeeKey,
  type ExplorerInstitution,
  type ExplorerMedian,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";

/** Never named on a public page (as on the district hub and the samples). */
export const HIDDEN_INSTITUTION = /frost bank/i;

/** A long waiver note is cut here; the full schedule is one click away on the institution's page. */
const CONDITIONS_MAX_CHARS = 220;
/** At most this many prices are listed for one value. */
const PRICES_MAX = 8;

function clip(text: string | null | undefined): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > CONDITIONS_MAX_CHARS ? `${clean.slice(0, CONDITIONS_MAX_CHARS - 1).trimEnd()}…` : clean;
}

/** One institution's value for one fee, with every price behind it when there is more than one. */
export function explorerFee(value: PeerFeeValue): ExplorerFee {
  const records = value.fee_records ?? [];
  const url = value.document_urls.find((u) => /^https?:\/\//i.test(u)) ?? null;
  const published = value.published_at ? value.published_at.slice(0, 10) : null;
  const source = url || published ? { source: { url, published } } : {};
  if (records.length < 2) return { amount: value.amount, ...source };
  return {
    amount: value.amount,
    prices: [...records]
      .sort((a, b) => a.amount - b.amount || a.id - b.id)
      .slice(0, PRICES_MAX)
      .map((record) => {
        const name = record.fee_name?.trim() || null;
        // The account's own short name ("Carefree Checking Monthly Maintenance Fee" -> "Carefree Checking").
        return { amount: record.amount, name, account: name ? productNameFromFeeName(name) : null, conditions: clip(record.conditions) };
      }),
    ...source,
  };
}

interface FactRow {
  id: number | string;
  institution_name: string | null;
  asset_size: number | string | null;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
}

/**
 * Builds the explorer's set from the institutions' facts and their fee values. The subject is
 * kept apart; a hidden institution is left out of the peers, so every count, median and dot on
 * the page is drawn from the same institutions a visitor can see.
 */
export function buildPeerExplorerSet(
  subjectId: number,
  facts: FactRow[],
  byCategory: Map<string, PeerFeeValue[]>,
): PeerExplorerSet | null {
  const fees = new Map<number, Partial<Record<ExplorerFeeKey, ExplorerFee>>>();
  for (const key of EXPLORER_FEE_KEYS) {
    for (const value of byCategory.get(key) ?? []) {
      const own = fees.get(value.institution_id) ?? {};
      own[key] = explorerFee(value);
      fees.set(value.institution_id, own);
    }
  }
  const toInstitution = (row: FactRow): ExplorerInstitution => {
    const id = Number(row.id);
    const thousands = row.asset_size === null || row.asset_size === "" ? NaN : Number(row.asset_size);
    return {
      id,
      name: institutionDisplayName(row.institution_name ?? "") || `Institution ${id}`,
      assets: Number.isFinite(thousands) && thousands > 0 ? thousands * 1000 : null,
      city: row.city ? displayCity(row.city) : null,
      state: row.state_code ?? null,
      fees: fees.get(id) ?? {},
    };
  };
  const subjectRow = facts.find((row) => Number(row.id) === subjectId);
  if (!subjectRow || HIDDEN_INSTITUTION.test(subjectRow.institution_name ?? "")) return null;
  const peers = facts
    .filter((row) => Number(row.id) !== subjectId && !HIDDEN_INSTITUTION.test(row.institution_name ?? ""))
    .map(toInstitution);
  const medians: Partial<Record<ExplorerFeeKey, ExplorerMedian>> = {};
  for (const key of EXPLORER_FEE_KEYS) {
    const values = peers.map((peer) => peer.fees[key]?.amount).filter((v): v is number => v !== undefined);
    if (values.length >= MIN_PEERS_FOR_PEER_SET_MEDIAN) {
      const { median } = computeStats(values);
      if (median !== null) medians[key] = { median, peers: values.length };
    }
  }
  const shownIds = new Set([subjectId, ...peers.map((peer) => peer.id)]);
  const dates = [...byCategory.values()]
    .flat()
    .filter((value) => shownIds.has(value.institution_id) && value.published_at)
    .map((value) => (value.published_at as string).slice(0, 10))
    .sort();
  return { subject: toInstitution(subjectRow), peers, charterType: subjectRow.charter_type ?? null, medians, asOf: dates.pop() ?? null };
}

/**
 * One peer set for the explorer. `filters` is the set as public-peer-sets.ts resolved it: chosen
 * institutions (nearest, metro, regulator) or a plain filter (state, Fed district, size), whose
 * members peer-sets.ts finds. Members are the institutions that publish at least one approved fee,
 * the same rule the nearest set uses, so every listed peer has a schedule to compare.
 */
export async function getPeerExplorerSet(
  institutionId: number,
  filters: PeerFilterSet,
  /** True for the home metro set: Locations then groups by branch city inside the metro. */
  homeMarket = false,
): Promise<PeerExplorerSet | null> {
  const subject = await getPeerSubject(institutionId);
  if (!subject) return null;
  const chosen = peerInstitutionIds(filters);
  const memberIds = chosen ? chosen.filter((id) => id !== institutionId) : await resolvePeerInstitutionIds(filters, subject);
  const ids = [institutionId, ...memberIds];
  const facts = (await sql`
    SELECT s.id, s.institution_name, s.asset_size, s.city, s.state_code, s.charter_type
      FROM institution_sources s
     WHERE s.id = ANY(${ids}::bigint[])
       AND (s.id = ${institutionId}
            OR EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = s.id AND p.review_status = 'approved'))
  `) as FactRow[];
  const set = await readCappedSet(institutionId, facts);
  if (!set || !homeMarket) return set;
  const market = await getHomeMarket(institutionId);
  if (!market) return set;
  const shown = [set.subject.id, ...set.peers.map((peer) => peer.id)];
  const [cities, presence] = await Promise.all([getMarketBranchCities(market.code, shown), getMarketPresence(market.code, shown)]);
  return {
    ...set,
    market: {
      name: market.name,
      cities: groupBranchCities(cities),
      presence: Object.fromEntries(presence.rows.map((row) => [row.institution_id, { branches: row.branches, deposits: row.deposits }])),
      totalDeposits: presence.totalDeposits,
    },
  };
}

/** Each institution's explorer fees, with every price and its conditions only when asked. */
async function readFees(facts: FactRow[], withConditions: boolean): Promise<Map<string, PeerFeeValue[]>> {
  const ids = facts.map((row) => Number(row.id));
  const [byCategory] = await getPeerFeeValues([{ institutionIds: ids }], [...EXPLORER_FEE_KEYS], undefined, { onlyInstitutionIds: ids, withConditions });
  return byCategory ?? new Map();
}

/**
 * The set as the page receives it. A set at or under PEER_EXPLORER_MAX_SHOWN reads every price
 * and condition at once. A larger one (an asset band, a regulator, a state or a Fed district can
 * hold thousands) reads amounts for every member, so medians and counts are the whole set's, then
 * keeps the closest in assets and reads prices and conditions for those alone.
 */
async function readCappedSet(institutionId: number, facts: FactRow[]): Promise<PeerExplorerSet | null> {
  if (facts.length <= PEER_EXPLORER_MAX_SHOWN + 1) return buildPeerExplorerSet(institutionId, facts, await readFees(facts, true));
  const whole = buildPeerExplorerSet(institutionId, facts, await readFees(facts, false));
  if (!whole) return null;
  const capped = capPeerExplorerSet(whole);
  const kept = new Set([institutionId, ...capped.peers.map((peer) => peer.id)]);
  const keptFacts = facts.filter((row) => kept.has(Number(row.id)));
  const detailed = buildPeerExplorerSet(institutionId, keptFacts, await readFees(keptFacts, true));
  if (!detailed) return null;
  const order = new Map(capped.peers.map((peer, i) => [peer.id, i]));
  return {
    ...detailed,
    peers: [...detailed.peers].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    medians: capped.medians,
    asOf: capped.asOf,
    whole: capped.whole,
  };
}

/** Branch rows (one per institution and city) as one entry per city. */
export function groupBranchCities(rows: { institution_id: number; city: string; state: string }[]): { city: string; state: string; ids: number[] }[] {
  const cities = new Map<string, { city: string; state: string; ids: number[] }>();
  for (const row of rows) {
    const key = `${row.city.toUpperCase()}|${row.state}`;
    const entry = cities.get(key) ?? { city: row.city, state: row.state, ids: [] };
    if (!entry.ids.includes(row.institution_id)) entry.ids.push(row.institution_id);
    cities.set(key, entry);
  }
  return [...cities.values()];
}
