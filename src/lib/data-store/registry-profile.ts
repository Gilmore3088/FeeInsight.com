import { sql } from "./connection";
import { stateAgencyCode } from "@/lib/regulatory/state-enforcement";
import { buildLocalOfficeMap, localMapBounds, LOCAL_MAP_MAX_STATES, type LocalOfficeMap } from "@/lib/geo/local-office-map";
import { getLocalMarketMembers } from "./custom-report-market";
import { latestSodYear } from "@/lib/agents/magellan/registry/fdic-sod";

/**
 * Reads for the gated institution profile built on the regulatory registry:
 * branch footprint (FDIC SOD for banks, NCUA's branch file for credit unions), CFPB complaints, SEC filings and holding-company
 * financials, and regulator identity. Every function reads only registry
 * tables, so callers wrap each one in a fallback.
 */

const numOrNull = (v: unknown): number | null => (v !== null && v !== undefined ? Number(v) : null);
const dateStr = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

export interface BranchYear {
  year: number;
  branches: number;
  /** Thousands of dollars (SOD convention). */
  deposits: number;
}

export interface BranchMarket {
  /** A metro area for banks; a city ("Austin, TX") for credit unions. */
  msa_name: string;
  branches: number;
  deposits: number;
}

export interface BranchState {
  state: string;
  branches: number;
  deposits: number;
}

export interface BranchFootprint {
  /** fdic_sod: bank branches with deposits. ncua: credit union offices, no deposits (all zero). */
  source: "fdic_sod" | "ncua";
  /** NCUA only: the quarter-end date of the branch file. */
  reportDate?: string | null;
  latestYear: number;
  byYear: BranchYear[];
  byState: BranchState[];
  topMarkets: BranchMarket[];
  /** A zoomed map with a dot per office when the offices sit in a few states; else null (national map). */
  localMap?: CardLocalMap | null;
  /**
   * The largest competitors in the institution's local market, by the definition the
   * custom report and the API use (getLocalMarketMembers): deposit share first.
   */
  nearby?: NearbyInstitution[];
  /** How many other institutions are in the local market. */
  nearbyCount?: number;
  /** Banks only: this bank's share of the bank deposits in its local market, in percent. */
  ownDepositSharePct?: number | null;
  /** Offices placed on the zoomed map (credit union coordinates are added over time). */
  mappedOffices?: number;
  /** True when the zoomed map applies but too few offices are placed yet to draw it. */
  mapPending?: boolean;
  /** Offices on the map drawn at the middle of their town until their address is geocoded. */
  approxOffices?: number;
}

type OfficePoint = {
  latitude: number | string;
  longitude: number | string;
  city: string | null;
  weight?: number | string | null;
  /** Placed at the middle of its town, not its own address. */
  approx?: boolean | null;
};

/** The zoomed map as the card receives it (server-only fields removed). */
export type CardLocalMap = Omit<LocalOfficeMap, "othersInFrame" | "ownWeightInFrame">;

export interface NearbyInstitution {
  name: string;
  charter: "bank" | "credit_union";
  /** Share of the bank deposits in the local market, in percent; null for credit unions (no branch deposits). */
  depositSharePct: number | null;
}

const NEARBY_LIMIT = 5;

interface OtherOffice {
  institution_id: number | string | null;
  name: string | null;
  kind: "bank" | "credit_union";
  latitude: number | string;
  longitude: number | string;
  deposits: number | string | null;
}

/** Every other bank branch (latest SOD year) and credit union office with coordinates in the box. */
async function otherOfficesIn(
  institutionId: number,
  box: { south: number; north: number; west: number; east: number },
): Promise<OtherOffice[]> {
  const rows = await sql<OtherOffice[]>`
    SELECT b.institution_id, s.institution_name AS name, 'bank'::text AS kind, b.latitude, b.longitude, b.deposits
      FROM institution_branch_deposits b
      LEFT JOIN institution_sources s ON s.id = b.institution_id
     WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
       AND b.latitude BETWEEN ${box.south} AND ${box.north}
       AND b.longitude BETWEEN ${box.west} AND ${box.east}
       AND b.institution_id IS DISTINCT FROM ${institutionId}
    UNION ALL
    SELECT c.institution_id, COALESCE(s.institution_name, c.cu_name), 'credit_union', c.latitude, c.longitude, NULL
      FROM credit_union_branches c
      LEFT JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.latitude BETWEEN ${box.south} AND ${box.north}
       AND c.longitude BETWEEN ${box.west} AND ${box.east}
       AND c.institution_id IS DISTINCT FROM ${institutionId}`;
  return [...rows];
}

/** The largest competitors in the institution's local market, and a bank's own deposit share there. */
async function marketCompetitors(
  institutionId: number,
): Promise<Pick<BranchFootprint, "nearby" | "nearbyCount" | "ownDepositSharePct">> {
  const market = await getLocalMarketMembers(institutionId).catch(() => null);
  if (!market) return { nearby: [], nearbyCount: 0, ownDepositSharePct: null };
  const total = market.members.reduce((sum, m) => sum + (m.market_deposits ?? 0), 0);
  const share = (deposits: number | null) =>
    deposits === null || total <= 0 ? null : Math.round((deposits / total) * 1000) / 10;
  const rivals = market.members.filter((m) => !m.is_subject);
  const subject = market.members.find((m) => m.is_subject);
  return {
    nearby: rivals.slice(0, NEARBY_LIMIT).map((m) => ({
      name: m.institution_name,
      charter: m.charter_type === "credit_union" ? "credit_union" : "bank",
      depositSharePct: share(m.market_deposits),
    })),
    nearbyCount: rivals.length,
    ownDepositSharePct: subject ? share(subject.market_deposits) : null,
  };
}

/**
 * The zoomed map with other institutions' offices on it, the few with the most offices
 * in view, and (for a bank) its share of bank deposits in view. Empty when the
 * institution's offices span too many states for the zoomed map.
 */
/** Share of an institution's offices that must have coordinates before its zoomed map is drawn. */
const MIN_MAPPED_SHARE = 0.5;

async function localMapFor(
  institutionId: number,
  states: string[],
  points: OfficePoint[],
  isBank: boolean,
  totalOffices: number,
): Promise<Pick<BranchFootprint, "localMap" | "mappedOffices" | "mapPending" | "approxOffices" | "nearby" | "nearbyCount" | "ownDepositSharePct">> {
  if (states.length === 0 || states.length > LOCAL_MAP_MAX_STATES) return { localMap: null, mappedOffices: 0 };
  const own = points.map((p) => ({
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    city: p.city,
    weight: p.weight == null ? 1 : Number(p.weight),
  }));
  const box = localMapBounds(states, own);
  const others = box ? await otherOfficesIn(institutionId, box) : [];
  const map = buildLocalOfficeMap(
    states,
    own,
    others.map((o) => ({ latitude: Number(o.latitude), longitude: Number(o.longitude) })),
  );
  if (!map) return { localMap: null, mappedOffices: 0 };

  // A map with one dot for nine offices misleads, so wait until most offices are placed.
  if (map.dots.length < Math.max(1, Math.ceil(totalOffices * MIN_MAPPED_SHARE))) {
    return { localMap: null, mappedOffices: map.dots.length, mapPending: true, ...(await marketCompetitors(institutionId)) };
  }
  const { othersInFrame: _inFrame, ownWeightInFrame, ...localMap } = map;
  void _inFrame;
  void ownWeightInFrame;
  const approxOffices = points.filter((p) => p.approx).length;
  return { localMap, mappedOffices: map.dots.length, approxOffices, ...(await marketCompetitors(institutionId)) };
}

export async function getBranchFootprint(institutionId: number): Promise<BranchFootprint | null> {
  const byYear = await sql<Array<{ year: number; branches: number; deposits: string }>>`
    SELECT year, COUNT(*)::int AS branches, COALESCE(SUM(deposits), 0) AS deposits
      FROM institution_branch_deposits
     WHERE institution_id = ${institutionId}
     GROUP BY year
     ORDER BY year`;
  if (byYear.length === 0) return getCreditUnionFootprint(institutionId);
  const latestYear = Number(byYear[byYear.length - 1].year);
  const [byState, topMarkets] = await Promise.all([
    sql<Array<{ state: string; branches: number; deposits: string }>>`
      SELECT state, COUNT(*)::int AS branches, COALESCE(SUM(deposits), 0) AS deposits
        FROM institution_branch_deposits
       WHERE institution_id = ${institutionId} AND year = ${latestYear} AND state IS NOT NULL
       GROUP BY state
       ORDER BY branches DESC`,
    sql<Array<{ msa_name: string; branches: number; deposits: string }>>`
      SELECT COALESCE(msa_name, 'Outside a metro area') AS msa_name, COUNT(*)::int AS branches,
             COALESCE(SUM(deposits), 0) AS deposits
        FROM institution_branch_deposits
       WHERE institution_id = ${institutionId} AND year = ${latestYear}
       GROUP BY 1
       ORDER BY 3 DESC
       LIMIT 8`,
  ]);
  const points =
    byState.length > 0 && byState.length <= LOCAL_MAP_MAX_STATES
      ? await sql<OfficePoint[]>`
          SELECT latitude, longitude, INITCAP(city) AS city, COALESCE(deposits, 0) AS weight
            FROM institution_branch_deposits
           WHERE institution_id = ${institutionId} AND year = ${latestYear}
             AND latitude IS NOT NULL AND longitude IS NOT NULL`
      : [];
  return {
    source: "fdic_sod",
    latestYear,
    byYear: byYear.map((r) => ({ year: Number(r.year), branches: Number(r.branches), deposits: Number(r.deposits) })),
    byState: byState.map((r) => ({ state: r.state, branches: Number(r.branches), deposits: Number(r.deposits) })),
    topMarkets: topMarkets.map((r) => ({ msa_name: r.msa_name, branches: Number(r.branches), deposits: Number(r.deposits) })),
    ...(await localMapFor(institutionId, byState.map((r) => r.state), [...points], true, Number(byYear[byYear.length - 1]?.branches ?? 0))),
  };
}

/**
 * A credit union's offices from NCUA's branch file (latest quarter only, so one year).
 * NCUA reports no deposits by office, so deposit fields are zero and the card hides them;
 * markets are the cities with the most offices.
 */
async function getCreditUnionFootprint(institutionId: number): Promise<BranchFootprint | null> {
  const [byState, topCities, [latest]] = await Promise.all([
    sql<Array<{ state: string; branches: number }>>`
      SELECT state, COUNT(*)::int AS branches
        FROM credit_union_branches
       WHERE institution_id = ${institutionId} AND state IS NOT NULL
       GROUP BY state
       ORDER BY branches DESC`,
    sql<Array<{ city: string; branches: number }>>`
      SELECT INITCAP(city) || ', ' || state AS city, COUNT(*)::int AS branches
        FROM credit_union_branches
       WHERE institution_id = ${institutionId} AND city IS NOT NULL AND state IS NOT NULL
       GROUP BY 1
       ORDER BY 2 DESC, 1
       LIMIT 8`,
    sql<Array<{ branches: number; report_date: unknown }>>`
      SELECT COUNT(*)::int AS branches, MAX(report_date) AS report_date
        FROM credit_union_branches
       WHERE institution_id = ${institutionId}`,
  ]);
  const total = Number(latest?.branches ?? 0);
  if (total === 0) return null;
  const points =
    byState.length > 0 && byState.length <= LOCAL_MAP_MAX_STATES
      ? await sql<OfficePoint[]>`
          -- An office not geocoded yet is drawn at the middle of the known offices in its
          -- town (bank branches from the last two SOD years and geocoded credit union offices).
          SELECT COALESCE(b.latitude, t.latitude) AS latitude,
                 COALESCE(b.longitude, t.longitude) AS longitude,
                 INITCAP(b.city) AS city,
                 (b.latitude IS NULL) AS approx
            FROM credit_union_branches b
            LEFT JOIN LATERAL (
              SELECT AVG(k.latitude) AS latitude, AVG(k.longitude) AS longitude FROM (
                SELECT d.latitude, d.longitude FROM institution_branch_deposits d
                 WHERE d.state = b.state AND upper(d.city) = upper(b.city)
                   AND d.year >= ${latestSodYear(new Date()) - 1} AND d.latitude IS NOT NULL
                UNION ALL
                SELECT c.latitude, c.longitude FROM credit_union_branches c
                 WHERE c.state = b.state AND upper(c.city) = upper(b.city) AND c.latitude IS NOT NULL
              ) k
            ) t ON b.latitude IS NULL
           WHERE b.institution_id = ${institutionId}
             AND COALESCE(b.latitude, t.latitude) IS NOT NULL`
      : [];
  const reportDate = dateStr(latest.report_date);
  const year = reportDate ? Number(reportDate.slice(0, 4)) : new Date().getUTCFullYear();
  return {
    source: "ncua",
    reportDate,
    latestYear: year,
    byYear: [{ year, branches: total, deposits: 0 }],
    byState: byState.map((r) => ({ state: r.state, branches: Number(r.branches), deposits: 0 })),
    topMarkets: topCities.map((r) => ({ msa_name: r.city, branches: Number(r.branches), deposits: 0 })),
    ...(await localMapFor(institutionId, byState.map((r) => r.state), [...points], false, total)),
  };
}

export interface ComplaintYearProduct {
  year: string;
  product: string;
  count: number;
}

export interface ComplaintTrend {
  byYearProduct: ComplaintYearProduct[];
  topIssues: Array<{ issue: string; count: number }>;
  latestYear: string | null;
}

export async function getComplaintTrend(institutionId: number): Promise<ComplaintTrend | null> {
  const rows = await sql<Array<{ report_period: string; product: string; complaint_count: number }>>`
    SELECT report_period, product, complaint_count
      FROM institution_complaint_records
     WHERE institution_id = ${institutionId} AND issue = '_total' AND product <> '_all'
       AND report_period ~ '^[0-9]{4}$'
     ORDER BY report_period`;
  if (rows.length === 0) return null;
  const latestYear = rows[rows.length - 1].report_period;
  const issues = await sql<Array<{ issue: string; complaint_count: number }>>`
    SELECT issue, complaint_count
      FROM institution_complaint_records
     WHERE institution_id = ${institutionId} AND product = '_all' AND report_period = ${latestYear}
     ORDER BY complaint_count DESC
     LIMIT 6`;
  return {
    byYearProduct: rows.map((r) => ({ year: r.report_period, product: r.product, count: Number(r.complaint_count) })),
    topIssues: issues.map((r) => ({ issue: r.issue, count: Number(r.complaint_count) })),
    latestYear,
  };
}

export interface InstitutionFiling {
  form: string;
  filed_at: string | null;
  period_of_report: string | null;
  primary_doc_url: string | null;
  description: string | null;
}

export interface HoldingCompanyQuarter {
  period_end: string;
  fiscal_period: string | null;
  total_assets: number | null;
  stockholders_equity: number | null;
  net_income: number | null;
  eps_diluted: number | null;
}

export interface HoldingCompanyProfile {
  cik: string;
  name: string | null;
  ticker: string | null;
  exchange: string | null;
  filings: InstitutionFiling[];
  quarters: HoldingCompanyQuarter[];
}

export async function getHoldingCompanyProfile(institutionId: number): Promise<HoldingCompanyProfile | null> {
  const [link] = await sql<Array<{ sec_cik: string | null; external_name: string | null; detail: Record<string, unknown> | null }>>`
    SELECT s.sec_cik, l.external_name, l.detail
      FROM institution_sources s
      LEFT JOIN institution_identity_links l
        ON l.link_type = 'sec_cik' AND l.external_key = s.sec_cik AND l.status = 'accepted'
     WHERE s.id = ${institutionId}`;
  const cik = link?.sec_cik;
  if (!cik) return null;
  const [filings, quarters] = await Promise.all([
    sql<Array<Record<string, unknown>>>`
      SELECT form, filed_at, period_of_report, primary_doc_url, description
        FROM institution_filings
       WHERE cik = ${cik} AND form IN ('10-K', '10-Q', '8-K', 'DEF 14A')
       ORDER BY filed_at DESC
       LIMIT 12`,
    sql<Array<Record<string, unknown>>>`
      SELECT period_end, fiscal_period, total_assets, stockholders_equity, net_income, eps_diluted
        FROM holding_company_financials
       WHERE cik = ${cik}
       ORDER BY period_end DESC
       LIMIT 24`,
  ]);
  const detail = link.detail ?? {};
  return {
    cik,
    name: link.external_name,
    ticker: typeof detail.ticker === "string" ? detail.ticker : null,
    exchange: typeof detail.exchange === "string" ? detail.exchange : null,
    filings: filings.map((r) => ({
      form: String(r.form),
      filed_at: dateStr(r.filed_at),
      period_of_report: dateStr(r.period_of_report),
      primary_doc_url: r.primary_doc_url ? String(r.primary_doc_url) : null,
      description: r.description ? String(r.description) : null,
    })),
    quarters: quarters
      .map((r) => ({
        period_end: dateStr(r.period_end) ?? "",
        fiscal_period: r.fiscal_period ? String(r.fiscal_period) : null,
        total_assets: numOrNull(r.total_assets),
        stockholders_equity: numOrNull(r.stockholders_equity),
        net_income: numOrNull(r.net_income),
        eps_diluted: numOrNull(r.eps_diluted),
      }))
      .reverse(),
  };
}

export interface RegulatorInfo {
  primary_regulator: string | null;
  charter_agency: string | null;
  holding_company_name: string | null;
  regulatory_status: string | null;
  closed_date: string | null;
  cu_charter_type: string | null;
  state_agency_name: string | null;
  state_agency_url: string | null;
}

/** Public (non-gated) identity facts for the profile sidebar. */
export async function getRegulatorInfo(institutionId: number): Promise<RegulatorInfo | null> {
  const [row] = await sql<Array<Record<string, unknown>>>`
    SELECT s.primary_regulator, s.charter_agency, s.holding_company_name, s.regulatory_status,
           s.closed_date, s.cu_charter_type,
           CASE WHEN s.charter_type = 'credit_union' AND r.credit_union_agency_name IS NOT NULL
                THEN r.credit_union_agency_name ELSE r.agency_name END AS state_agency_name,
           CASE WHEN s.charter_type = 'credit_union' AND r.credit_union_agency_name IS NOT NULL
                THEN r.credit_union_website_url ELSE r.website_url END AS state_agency_url
      FROM institution_sources s
      LEFT JOIN state_regulators r ON r.state_code = s.state_code AND s.charter_agency = 'State'
     WHERE s.id = ${institutionId}`;
  if (!row) return null;
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    primary_regulator: text(row.primary_regulator),
    charter_agency: text(row.charter_agency),
    holding_company_name: text(row.holding_company_name),
    regulatory_status: text(row.regulatory_status),
    closed_date: dateStr(row.closed_date),
    cu_charter_type: text(row.cu_charter_type),
    state_agency_name: text(row.state_agency_name),
    state_agency_url: text(row.state_agency_url),
  };
}

export interface EnforcementActionRow {
  /** "OCC", "FRB", or a state banking department ("STATE_NJ"); enforcementAgencyLabel names it. */
  agency: string;
  party_name: string;
  /** True when the action names the holding company rather than this institution. */
  against_holding_company: boolean;
  action_type: string | null;
  subject: string | null;
  start_date: string | null;
  termination_date: string | null;
  penalty_amount: number | null;
  document_url: string | null;
}

export interface EnforcementRecord {
  /** Agencies whose list is loaded and whose actions could name this institution. */
  agenciesChecked: string[];
  /**
   * Orders with no end date on file that began in the last OPEN_ACTION_YEARS years, newest
   * first. The agencies don't always record an end date, so these may have ended; they are
   * never called active.
   */
  open: EnforcementActionRow[];
  /** Everything else (ended, a penalty alone, or older), newest first, at most ENFORCEMENT_RECENT_LIMIT. */
  past: EnforcementActionRow[];
  pastCount: number;
  /** Date the lists were last read. */
  asOf: string | null;
}

const ENFORCEMENT_RECENT_LIMIT = 5;
export const OPEN_ACTION_YEARS = 10;

/** A civil money penalty with no order attached is done once assessed; it has no end date. */
export function isPenaltyOnly(actionType: string | null | undefined): boolean {
  return Boolean(actionType && /penalty|\bCMP\b/i.test(actionType) && !/cease|desist|agreement|order|directive|prompt corrective/i.test(actionType));
}

/** No end date on file, more than a penalty, and recent enough that it may still be in force. */
export function isOpenAction(action: Pick<EnforcementActionRow, "termination_date" | "action_type" | "start_date">, today: Date = new Date()): boolean {
  if (action.termination_date || isPenaltyOnly(action.action_type) || !action.start_date) return false;
  const cutoff = new Date(today);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - OPEN_ACTION_YEARS);
  return action.start_date >= cutoff.toISOString().slice(0, 10);
}
const agencyOrder = (a: string) => (a === "OCC" ? 0 : a === "FRB" ? 1 : 2);
const AGENCY_FOR_REGULATOR: Record<string, "OCC" | "FRB"> = { OCC: "OCC", "Federal Reserve": "FRB" };

/**
 * OCC and Federal Reserve enforcement actions naming this bank or its holding company.
 * Null for credit unions, and for a bank with none on file whose regulator's list isn't
 * loaded (FDIC-supervised banks: FDIC orders aren't loaded), so "none" is only ever said
 * where the list was actually checked.
 */
export async function getEnforcementRecord(institutionId: number): Promise<EnforcementRecord | null> {
  const [inst] = await sql<Array<Record<string, unknown>>>`
    SELECT charter_type, primary_regulator, holding_company_name, state_code, charter_agency FROM institution_sources WHERE id = ${institutionId}`;
  if (!inst || inst.charter_type !== "bank") return null;
  const holding = inst.holding_company_name ? String(inst.holding_company_name) : null;
  const loaded = await sql<Array<Record<string, unknown>>>`
    SELECT agency, MAX(fetched_at) AS fetched_at FROM institution_enforcement_actions GROUP BY agency`;
  const loadedAgencies = new Set(loaded.map((r) => String(r.agency)));
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT agency, party_name, institution_id, action_type, subject, start_date, termination_date,
           penalty_amount, document_url
      FROM institution_enforcement_actions
     WHERE institution_id = ${institutionId}
        OR (${holding}::text IS NOT NULL AND holding_company = ${holding})
     ORDER BY start_date DESC NULLS LAST, id DESC`;
  const actions: EnforcementActionRow[] = rows.map((r) => ({
    agency: String(r.agency),
    party_name: String(r.party_name),
    against_holding_company: r.institution_id === null || Number(r.institution_id) !== institutionId,
    action_type: r.action_type ? String(r.action_type) : null,
    subject: r.subject ? String(r.subject) : null,
    start_date: dateStr(r.start_date),
    termination_date: dateStr(r.termination_date),
    penalty_amount: numOrNull(r.penalty_amount),
    document_url: r.document_url ? String(r.document_url) : null,
  }));
  const regulatorAgency = AGENCY_FOR_REGULATOR[String(inst.primary_regulator ?? "")];
  const checked = new Set<string>();
  if (regulatorAgency && loadedAgencies.has(regulatorAgency)) checked.add(regulatorAgency);
  // The Fed supervises holding companies, so its list is checked for any bank that has one.
  if (holding && loadedAgencies.has("FRB")) checked.add("FRB");
  // A state-chartered bank's own state department, when that state's orders are loaded.
  const stateAgency = inst.charter_agency === "State" && inst.state_code ? stateAgencyCode(String(inst.state_code).trim()) : null;
  if (stateAgency && loadedAgencies.has(stateAgency)) checked.add(stateAgency);
  for (const a of actions) checked.add(a.agency);
  if (checked.size === 0) return null;
  const open = actions.filter((a) => isOpenAction(a));
  const past = actions.filter((a) => !isOpenAction(a));
  const latest = loaded.map((r) => dateStr(r.fetched_at)).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
  return {
    agenciesChecked: [...checked].sort((a, b) => agencyOrder(a) - agencyOrder(b) || a.localeCompare(b)),
    open,
    past: past.slice(0, ENFORCEMENT_RECENT_LIMIT),
    pastCount: past.length,
    asOf: latest,
  };
}

// --- Admin: registry health ---

export interface RegistryPartitionStats {
  source: string;
  succeeded: number;
  empty: number;
  pending: number;
  retrying: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  rowsLoaded: number;
  unmatched: number;
}

export async function getRegistryPartitionStats(): Promise<RegistryPartitionStats[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT source,
           COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
           COUNT(*) FILTER (WHERE status = 'empty')::int AS empty,
           COUNT(*) FILTER (WHERE status IN ('scheduled', 'failed'))::int AS pending,
           COUNT(*) FILTER (WHERE status IN ('scheduled', 'failed') AND attempts > 1)::int AS retrying,
           MAX(fetched_at) AS last_fetched_at,
           (ARRAY_AGG(last_error ORDER BY updated_at DESC) FILTER (WHERE last_error IS NOT NULL))[1] AS last_error,
           COALESCE(SUM(row_count) FILTER (WHERE status = 'succeeded'), 0)::bigint AS rows_loaded,
           COALESCE(SUM(unmatched_count) FILTER (WHERE status = 'succeeded'), 0)::bigint AS unmatched
      FROM registry_ingest_partitions
     GROUP BY source`;
  return rows.map((r) => ({
    source: String(r.source),
    succeeded: Number(r.succeeded),
    empty: Number(r.empty),
    pending: Number(r.pending),
    retrying: Number(r.retrying),
    lastFetchedAt: r.last_fetched_at instanceof Date ? r.last_fetched_at.toISOString() : r.last_fetched_at ? String(r.last_fetched_at) : null,
    lastError: r.last_error ? String(r.last_error) : null,
    rowsLoaded: Number(r.rows_loaded),
    unmatched: Number(r.unmatched),
  }));
}

/**
 * State fee bills keep one row per state plus the scheduler's "current" batch row, so the
 * source's partition count isn't a completion ratio. This counts states read and states with bills.
 */
export async function getStateBillCoverage(): Promise<{ statesRead: number; withBills: number }> {
  const [row] = await sql<Array<{ states_read: number; with_bills: number }>>`
    SELECT COUNT(*) FILTER (WHERE status IN ('succeeded', 'empty'))::int AS states_read,
           COUNT(*) FILTER (WHERE status = 'succeeded' AND row_count > 0)::int AS with_bills
      FROM registry_ingest_partitions
     WHERE source = 'state-bills' AND partition_key <> 'current'`;
  return { statesRead: Number(row?.states_read ?? 0), withBills: Number(row?.with_bills ?? 0) };
}

export interface IdentityReviewItem {
  link_type: string;
  external_key: string;
  external_name: string | null;
  institution_id: number | null;
  institution_name: string | null;
  method: string;
  confidence: number;
}

export async function getIdentityLinksNeedingReview(limit = 25): Promise<IdentityReviewItem[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT l.link_type, l.external_key, l.external_name, l.institution_id, s.institution_name, l.method, l.confidence
      FROM institution_identity_links l
      LEFT JOIN institution_sources s ON s.id = l.institution_id
     WHERE l.status = 'needs_review'
     ORDER BY (l.detail->>'candidates')::int DESC NULLS LAST, l.external_name
     LIMIT ${limit}`;
  return rows.map((r) => ({
    link_type: String(r.link_type),
    external_key: String(r.external_key),
    external_name: r.external_name ? String(r.external_name) : null,
    institution_id: r.institution_id === null ? null : Number(r.institution_id),
    institution_name: r.institution_name ? String(r.institution_name) : null,
    method: String(r.method),
    confidence: Number(r.confidence),
  }));
}
