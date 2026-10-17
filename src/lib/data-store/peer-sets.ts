/**
 * One definition of a peer group, shared by the API, Hamilton's saved peer groups and the
 * public pages, so the same group is never computed two ways.
 *
 * The basic dimensions (charter, asset-size tier, Fed district, states) are PeerFilterSet's
 * own and pass straight through to the fee index. The rest are resolved here, in one query on
 * institution_sources (plus branch locations for a metro market), into the exact institutions
 * that meet every dimension; the fee index then reads those institutions as hand-picked peers.
 *
 * - asset range: institution_sources.asset_size, stored in thousands of dollars; the
 *   definition takes whole dollars.
 * - regulator: primary_regulator as the registry stores it (OCC, FDIC, Federal Reserve, NCUA).
 * - CU charter: cu_charter_type (federal or state), from the NCUA type code.
 * - holding company: holding_company_rssd (FDIC registry; banks only).
 * - market: a metro (MSA) by where institutions have branches (peer-markets.ts).
 * - nearest: the N institutions closest in total assets among those that meet every other
 *   dimension and publish at least one approved fee.
 */
import { sql } from "./connection";
import { peerInstitutionIds, type PeerFilterSet } from "./fee-index";
import { getHomeMarket, getMarketInstitutionIds, type PeerMarket } from "./peer-markets";
import { ASSET_TIER_RANGES } from "@/lib/hamilton/asset-tier-ranges";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";

import { MAX_NEAREST_PEERS, PEER_REGULATORS, type PeerRegulator } from "@/lib/peer-set-dimensions";

export { MAX_NEAREST_PEERS, PEER_REGULATORS, type PeerRegulator };

export interface PeerSetDefinition extends PeerFilterSet {
  /** Total assets in dollars, inclusive. */
  asset_min?: number;
  asset_max?: number;
  regulators?: PeerRegulator[];
  cu_charter?: "federal" | "state";
  holding_company_rssd?: string;
  /** Metro (MSA) code. */
  market_code?: number;
  /** The N closest in total assets to the subject institution. */
  nearest?: number;
}

/** "same" takes the subject institution's own value for that dimension. */
export interface PeerSetRequest {
  charter_type?: "bank" | "credit_union" | "same";
  asset_tiers?: string[] | "same";
  asset_min?: number;
  asset_max?: number;
  fed_districts?: number[] | "same";
  states?: string[] | "same";
  regulators?: PeerRegulator[] | "same";
  cu_charter?: "federal" | "state" | "same";
  holding_company?: string | "same";
  market?: number | "same";
  nearest?: number;
}

export interface PeerSubject {
  id: number;
  charter_type?: string | null;
  asset_size?: number | string | null;
  asset_size_tier?: string | null;
  fed_district?: number | string | null;
  state_code?: string | null;
  primary_regulator?: string | null;
  cu_charter_type?: string | null;
  holding_company_rssd?: string | null;
}

export class PeerSetError extends Error {}

export interface ResolvedPeerSet {
  definition: PeerSetDefinition;
  /** What the fee index reads. Null when no institution meets the definition. */
  filters: PeerFilterSet | null;
  label: string;
  market: PeerMarket | null;
}

const ADVANCED_KEYS = ["asset_min", "asset_max", "regulators", "cu_charter", "holding_company_rssd", "market_code", "nearest"] as const;

export function hasAdvancedDimensions(def: PeerSetDefinition): boolean {
  return ADVANCED_KEYS.some((key) => def[key] !== undefined);
}

function regulatorKey(label: string | null | undefined): PeerRegulator | null {
  const entry = Object.entries(PEER_REGULATORS).find(([, value]) => value === label);
  return entry ? (entry[0] as PeerRegulator) : null;
}

/** A request with "same" filled in from the subject institution. Dimensions it lacks are an error. */
export function definitionFor(subject: PeerSubject, request: PeerSetRequest, home: PeerMarket | null): PeerSetDefinition {
  const missing = (what: string): never => {
    throw new PeerSetError(`This institution has no ${what} on record, so "same" cannot be used for it`);
  };
  const def: PeerSetDefinition = {};
  if (request.charter_type) {
    def.charter_type = request.charter_type === "same" ? subject.charter_type ?? missing("charter type") : request.charter_type;
  }
  if (request.asset_tiers) {
    def.asset_tiers = request.asset_tiers === "same" ? [subject.asset_size_tier ?? missing("asset size")] : request.asset_tiers;
  }
  if (request.fed_districts) {
    const own = Number(subject.fed_district);
    def.fed_districts = request.fed_districts === "same"
      ? [Number.isInteger(own) && own >= 1 && own <= 12 ? own : missing("Fed district")]
      : request.fed_districts;
  }
  if (request.states) {
    def.states = request.states === "same" ? [subject.state_code ?? missing("state")] : request.states;
  }
  if (request.asset_min !== undefined) def.asset_min = request.asset_min;
  if (request.asset_max !== undefined) def.asset_max = request.asset_max;
  if (request.regulators) {
    def.regulators = request.regulators === "same" ? [regulatorKey(subject.primary_regulator) ?? missing("regulator")] : request.regulators;
  }
  if (request.cu_charter) {
    const own = subject.cu_charter_type === "federal" || subject.cu_charter_type === "state" ? subject.cu_charter_type : null;
    def.cu_charter = request.cu_charter === "same" ? own ?? missing("credit union charter") : request.cu_charter;
  }
  if (request.holding_company) {
    def.holding_company_rssd = request.holding_company === "same" ? subject.holding_company_rssd ?? missing("holding company") : request.holding_company;
  }
  if (request.market !== undefined) {
    def.market_code = request.market === "same" ? (home ?? missing("branch market")).code : request.market;
  }
  if (request.nearest !== undefined) def.nearest = request.nearest;
  return def;
}

/** "Texas", "Texas or Oklahoma", "Texas, Oklahoma or Kansas". */
function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function formatDollars(value: number): string {
  if (value >= 1e9) return `$${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${+(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString("en-US")}`;
}

/** A plain-words name for the group, e.g. "Banks with $300M to $1B in assets in Fed district 11 (Dallas)". */
export function describePeerSet(def: PeerSetDefinition, market: PeerMarket | null = null): string {
  const ids = peerInstitutionIds(def);
  if (ids && !hasAdvancedDimensions(def)) return `${ids.length} chosen ${ids.length === 1 ? "institution" : "institutions"}`;
  const kind = def.charter_type === "bank"
    ? "Banks"
    : def.charter_type === "credit_union"
      ? def.cu_charter ? `${def.cu_charter === "federal" ? "Federal" : "State"} credit unions` : "Credit unions"
      : def.cu_charter ? `${def.cu_charter === "federal" ? "Federal" : "State"} credit unions` : "Institutions";
  const parts = [def.nearest ? `The ${def.nearest} ${kind.toLowerCase()} closest in assets` : kind];
  if (def.asset_tiers?.length) {
    const ranges = def.asset_tiers.map((tier) => ASSET_TIER_RANGES[tier] ?? tier.replace(/_/g, " "));
    // "under $300M" and "over $250B" read on their own; a "$300M to $1B" range needs "with".
    const bare = ranges.length === 1 && /^(under|over) /.test(ranges[0]);
    parts.push(`${bare ? "" : "with "}${ranges.join(" or ")} in assets`);
  }
  if (def.asset_min !== undefined && def.asset_max !== undefined) parts.push(`with ${formatDollars(def.asset_min)} to ${formatDollars(def.asset_max)} in assets`);
  else if (def.asset_min !== undefined) parts.push(`with at least ${formatDollars(def.asset_min)} in assets`);
  else if (def.asset_max !== undefined) parts.push(`with at most ${formatDollars(def.asset_max)} in assets`);
  if (def.regulators?.length) parts.push(`regulated by ${def.regulators.map((r) => `the ${PEER_REGULATORS[r]}`).join(" or ")}`);
  if (def.holding_company_rssd) parts.push(`in the same holding company`);
  if (def.market_code !== undefined) parts.push(`with branches in the ${market?.name || `metro ${def.market_code}`} metro`);
  const states = [...(def.states ?? []), ...(def.state_code ? [def.state_code] : [])];
  if (states.length) parts.push(`in ${listWords(states.map((code) => STATE_NAMES[code] ?? code))}`);
  if (def.fed_districts?.length) {
    const names = def.fed_districts.map((d) => DISTRICT_NAMES[d] ?? `district ${d}`);
    parts.push(`in the ${listWords(names)} Fed ${names.length === 1 ? "district" : "districts"}`);
  }
  return parts.join(" ");
}

/**
 * The institutions meeting every dimension of a definition, leaving out the subject. Only
 * called when the definition has a dimension the fee index cannot filter on by itself.
 */
export async function resolvePeerInstitutionIds(
  def: PeerSetDefinition,
  subject: { id: number; asset_size?: number | string | null } | null,
  marketIds?: Set<number>,
): Promise<number[]> {
  const conditions: string[] = ["TRUE"];
  const params: unknown[] = [];
  const add = (clause: (p: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(clause(`$${params.length}`));
  };

  const chosen = peerInstitutionIds(def);
  if (chosen) add((p) => `s.id = ANY(${p}::bigint[])`, chosen);
  if (def.charter_type) add((p) => `s.charter_type = ${p}`, def.charter_type);
  if (def.asset_tiers?.length) add((p) => `s.asset_size_tier = ANY(${p}::text[])`, def.asset_tiers);
  if (def.fed_districts?.length) add((p) => `s.fed_district = ANY(${p}::int[])`, def.fed_districts);
  const states = [...(def.states ?? []), ...(def.state_code ? [def.state_code] : [])];
  if (states.length) add((p) => `s.state_code = ANY(${p}::text[])`, states);
  if (def.asset_min !== undefined) add((p) => `s.asset_size >= ${p}`, Math.ceil(def.asset_min / 1000));
  if (def.asset_max !== undefined) add((p) => `s.asset_size <= ${p}`, Math.floor(def.asset_max / 1000));
  if (def.regulators?.length) add((p) => `s.primary_regulator = ANY(${p}::text[])`, def.regulators.map((r) => PEER_REGULATORS[r]));
  if (def.cu_charter) add((p) => `s.cu_charter_type = ${p}`, def.cu_charter);
  if (def.holding_company_rssd) add((p) => `s.holding_company_rssd = ${p}`, def.holding_company_rssd);
  if (subject) add((p) => `s.id <> ${p}`, subject.id);

  if (def.market_code !== undefined) {
    const ids = marketIds ?? (await getMarketInstitutionIds(def.market_code))?.ids;
    if (!ids) throw new PeerSetError(`No metro market with code ${def.market_code}`);
    add((p) => `s.id = ANY(${p}::bigint[])`, [...ids]);
  }

  let order = "s.id";
  let limit = "";
  if (def.nearest !== undefined) {
    const own = Number(subject?.asset_size);
    if (!subject || !Number.isFinite(own) || own <= 0) throw new PeerSetError("This institution has no total assets on record, so nearest cannot be used for it");
    conditions.push("s.asset_size IS NOT NULL");
    conditions.push("EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = s.id AND p.review_status = 'approved')");
    params.push(own);
    order = `ABS(s.asset_size - $${params.length}::bigint), s.id`;
    params.push(def.nearest);
    limit = `LIMIT $${params.length}`;
  }

  const rows = (await sql.unsafe(
    `SELECT s.id FROM institution_sources s WHERE ${conditions.join(" AND ")} ORDER BY ${order} ${limit}`,
    params as never[],
  )) as { id: number | string }[];
  return rows.map((row) => Number(row.id));
}

/**
 * Resolves a definition into what the fee index reads. Basic definitions pass through
 * unchanged; any other dimension resolves to the exact institutions.
 */
export async function resolvePeerSet(def: PeerSetDefinition, subject: PeerSubject | null): Promise<ResolvedPeerSet> {
  const loaded = def.market_code !== undefined ? await getMarketInstitutionIds(def.market_code) : null;
  if (def.market_code !== undefined && !loaded) throw new PeerSetError(`No metro market with code ${def.market_code}`);
  const market = loaded?.market ?? null;
  const label = describePeerSet(def, market);
  if (!hasAdvancedDimensions(def)) {
    const chosen = peerInstitutionIds(def);
    const withoutSubject = chosen && subject ? chosen.filter((id) => id !== subject.id) : chosen;
    if (withoutSubject && withoutSubject.length === 0) return { definition: def, filters: null, label, market };
    return { definition: def, filters: withoutSubject ? { institutionIds: withoutSubject } : def, label, market };
  }
  const ids = await resolvePeerInstitutionIds(def, subject, loaded?.ids);
  return { definition: def, filters: ids.length ? { institutionIds: ids } : null, label, market };
}

/** The columns a peer definition reads from the subject institution, or null when unknown. */
export async function getPeerSubject(institutionId: number): Promise<PeerSubject | null> {
  const rows = (await sql`
    SELECT id, charter_type, asset_size, asset_size_tier, fed_district, state_code,
           primary_regulator, cu_charter_type, holding_company_rssd
      FROM institution_sources WHERE id = ${institutionId}
  `) as (PeerSubject & { id: number | string })[];
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

/** A request's definition for one institution, resolved: "same" filled in, then the peers found. */
export async function resolvePeerRequest(subject: PeerSubject, request: PeerSetRequest): Promise<ResolvedPeerSet> {
  const home = request.market === "same" ? await getHomeMarket(subject.id) : null;
  return resolvePeerSet(definitionFor(subject, request, home), subject);
}
