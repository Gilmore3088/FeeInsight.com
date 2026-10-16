import { sql } from "./connection";
import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { buildIndexEntries } from "./fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STATS_ROW_FILTER } from "./fee-stats";
import { financialSourceFilter } from "./financial-sources";
import { feeComplaintFilterSql } from "./complaints";
import { buildIndicatorSeries, type IndicatorSeries } from "./economic-context";
import { getFeeChangeEvents, type FeeChangeEvent } from "./fee-changes";
import { institutionDisplayName } from "@/lib/institution-display-name";

/**
 * Everything the district hub draws beyond the fee board, in one cached read. Each part comes
 * from a table a registry or pipeline step already keeps fresh, grouped by the district's states:
 * fee medians from published_fee_catalog, institutions from institution_sources, deposit
 * service charges from FDIC/NCUA call reports, branches from the FDIC Summary of Deposits and
 * NCUA's branch file, CFPB complaints for institutions with an accepted CFPB match, Census ACS
 * income, and FRED/BLS series. A part whose table is missing or empty comes back empty, and
 * the page drops that exhibit; nothing is filled with zeros.
 */

/** The fees the state comparison reads, in board order. */
export const HUB_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"] as const;

/** Institutions with an accepted CFPB match a complaint rate needs. */
export const MIN_COMPLAINT_PEERS = 10;

/** Deposit leaders the hub lists. */
export const HUB_LEADERS = 8;

/**
 * Branches a bank needs in the district's states to be listed as a leader. Single-office
 * online, brokerage and industrial banks (Morgan Stanley, Schwab, USAA, Ally) book hundreds of
 * billions at one address in Utah or Texas and would otherwise top the list.
 */
export const MIN_LEADER_BRANCHES = 10;

const FEE_CHANGE_LIMIT = 500;

export interface HubFeeMedian {
  /** null below MIN_INSTITUTIONS_FOR_MEDIAN institutions. */
  median: number | null;
  institutions: number;
}

export interface HubStateFees {
  state_code: string;
  fees: Record<string, HubFeeMedian>;
}

export interface HubInstitutionGroup {
  state_code: string;
  charter_type: "bank" | "credit_union" | "other";
  tier: string | null;
  institutions: number;
  /** Of those, institutions with at least one verified published fee. */
  with_fees: number;
}

export interface HubRevenueRow {
  quarter: string;
  state_code: string;
  charter_type: "bank" | "credit_union" | "other";
  /** Deposit service-charge income for the quarter, in thousands. */
  total: number;
  institutions: number;
}

export interface HubBranches {
  sod_year: number;
  /** Bank branches and their deposits (whole dollars) by state, FDIC Summary of Deposits. */
  by_state: { state_code: string; branches: number; deposits: number }[];
  /** Credit union branches by state, NCUA branch file (no deposits by branch). */
  cu_by_state: { state_code: string; branches: number }[];
  /** Largest banks by deposits in the district's states; deposits in whole dollars. */
  leaders: { institution_id: number; name: string; branches: number; deposits: number }[];
  total_deposits: number;
}

export interface HubComplaintGroup {
  fed_district: number | null;
  state_code: string | null;
  /** Institutions with an accepted CFPB company match. */
  matched: number;
  /** Of those, institutions with deposits on file, whose complaints count toward the rate. */
  with_deposits: number;
  fee_complaints: number;
  total_complaints: number;
  /** Fee complaints at institutions with deposits on file. */
  fee_complaints_rated: number;
  /** Deposits of those institutions, in thousands. */
  deposits: number;
}

export interface HubComplaints {
  year: string;
  /** One row per Fed district and state, nationwide, so the page can read the district against the U.S. */
  groups: HubComplaintGroup[];
}

export interface HubDemographics {
  state_code: string;
  median_household_income: number | null;
  poverty_count: number | null;
  total_population: number | null;
  year: number;
}

export interface DistrictHubData {
  district: number;
  states: string[];
  state_fees: HubStateFees[];
  institutions: HubInstitutionGroup[];
  revenue: HubRevenueRow[];
  branches: HubBranches | null;
  complaints: HubComplaints | null;
  demographics: HubDemographics[];
  /** FRED/BLS series by id: {ST}UR, {ST}NA, UNRATE and CPI bank services. */
  series: Record<string, IndicatorSeries>;
  fee_changes: FeeChangeEvent[];
  fee_changes_capped: boolean;
  fee_changes_since: string;
}

export function districtStates(district: number): string[] {
  return Object.entries(STATE_TO_DISTRICT)
    .filter(([, d]) => d === district)
    .map(([code]) => code)
    .sort();
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const charterOf = (v: unknown): "bank" | "credit_union" | "other" =>
  v === "bank" ? "bank" : v === "credit_union" ? "credit_union" : "other";

/** A part whose table is missing or unreadable is an empty part, never a failed page. */
async function part<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch {
    return empty;
  }
}

interface FeeRow {
  state_code: string | null;
  fee_category: string;
  amount: number | null;
  institution_id: number;
  review_status: string;
  created_at: string;
  charter_type: string;
}

/** Each state's median for the hub fees, by the statistics contract (one value per institution). */
export function buildStateFeeMedians(rows: FeeRow[]): HubStateFees[] {
  const byState = new Map<string, FeeRow[]>();
  for (const row of rows) {
    const code = row.state_code?.trim();
    if (!code) continue;
    const list = byState.get(code);
    if (list) list.push(row);
    else byState.set(code, [row]);
  }
  return [...byState.entries()]
    .map(([state_code, list]) => {
      const fees: Record<string, HubFeeMedian> = {};
      for (const entry of buildIndexEntries(list)) {
        fees[entry.fee_category] = {
          median: entry.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN ? entry.median_amount : null,
          institutions: entry.institution_count,
        };
      }
      return { state_code, fees };
    })
    .sort((a, b) => a.state_code.localeCompare(b.state_code));
}

const FROST_BANK = /frost bank/i;

/** Branch banks by deposits across the district's states. Frost Bank is never listed. */
export function buildLeaders(
  rows: Record<string, unknown>[],
  limit = HUB_LEADERS,
): HubBranches["leaders"] {
  const byId = new Map<number, { institution_id: number; name: string; branches: number; deposits: number }>();
  for (const row of rows) {
    if (row.institution_id == null) continue;
    const id = num(row.institution_id);
    const name = institutionDisplayName(row.institution_name == null ? null : String(row.institution_name)) ?? "";
    if (!name || FROST_BANK.test(name)) continue;
    const prior = byId.get(id) ?? { institution_id: id, name, branches: 0, deposits: 0 };
    prior.branches += num(row.branches);
    prior.deposits += num(row.deposits) * 1_000;
    byId.set(id, prior);
  }
  return [...byId.values()].filter((l) => l.deposits > 0 && l.branches >= MIN_LEADER_BRANCHES).sort((a, b) => b.deposits - a.deposits).slice(0, limit);
}

async function loadStateFees(district: number): Promise<HubStateFees[]> {
  const rows = (await sql.unsafe(
    `SELECT ct.state_code, ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ct.fed_district = $1
        AND ef.fee_category = ANY($2::text[])
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [district, [...HUB_FEES]],
  )) as unknown as FeeRow[];
  return buildStateFeeMedians(rows);
}

async function loadInstitutions(district: number): Promise<HubInstitutionGroup[]> {
  const rows = (await sql.unsafe(
    `SELECT ct.state_code, ct.charter_type, ct.asset_size_tier AS tier,
            COUNT(*)::int AS institutions,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM published_fee_catalog ef
               WHERE ef.institution_id = ct.id AND ef.review_status = 'approved' AND ${STATS_ROW_FILTER}
            ))::int AS with_fees
       FROM institution_sources ct
      WHERE ct.fed_district = $1
        AND ct.regulatory_status IS DISTINCT FROM 'inactive'
      GROUP BY 1, 2, 3`,
    [district],
  )) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => r.state_code)
    .map((r) => ({
      state_code: String(r.state_code).trim(),
      charter_type: charterOf(r.charter_type),
      tier: r.tier == null ? null : String(r.tier),
      institutions: num(r.institutions),
      with_fees: num(r.with_fees),
    }));
}

/**
 * Quarterly fee income for the district's institutions over the last eight quarters, by state
 * and charter: banks' service charges on deposit accounts (FDIC) and credit unions' fee income
 * (NCUA account 131, a wider measure). NCUA year-to-date income is split into quarters the same
 * way as getDistrictIncomeTrend; only positive quarterly income counts. Filings before January of
 * three years ago are skipped: reading every filing since the 1990s took over 20 seconds on prod.
 */
async function loadRevenue(district: number, now: Date): Promise<HubRevenueRow[]> {
  const from = `${now.getUTCFullYear() - 3}-01-01`;
  const rows = (await sql.unsafe(
    `WITH filed AS (
       SELECT inf.institution_id,
              inf.source,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
        WHERE ${financialSourceFilter("inf")}
          AND ct.fed_district = $1
          AND inf.report_date >= $2
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT institution_id, rd,
              CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END AS income
         FROM filed
     ),
     recent AS (
       SELECT DISTINCT DATE_TRUNC('quarter', rd) AS q FROM quarterly ORDER BY 1 DESC LIMIT 8
     )
     SELECT TO_CHAR(DATE_TRUNC('quarter', q.rd), 'YYYY-"Q"Q') AS quarter,
            ct.state_code, ct.charter_type,
            SUM(q.income) AS total,
            COUNT(DISTINCT q.institution_id) AS institutions
       FROM quarterly q
       JOIN institution_sources ct ON ct.id = q.institution_id
      WHERE q.income > 0
        AND DATE_TRUNC('quarter', q.rd) IN (SELECT q FROM recent)
      GROUP BY 1, 2, 3
      ORDER BY 1`,
    [district, from],
  )) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => r.state_code)
    .map((r) => ({
      quarter: String(r.quarter),
      state_code: String(r.state_code).trim(),
      charter_type: charterOf(r.charter_type),
      total: num(r.total),
      institutions: num(r.institutions),
    }));
}

async function loadBranches(states: string[]): Promise<HubBranches | null> {
  const rows = (await sql.unsafe(
    `SELECT b.year, b.state, b.institution_id, s.institution_name,
            COUNT(*)::int AS branches, SUM(COALESCE(b.deposits, 0)) AS deposits
       FROM institution_branch_deposits b
       LEFT JOIN institution_sources s ON s.id = b.institution_id
      WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
        AND b.state = ANY($1::text[])
      GROUP BY 1, 2, 3, 4`,
    [states],
  )) as unknown as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const byState = new Map<string, { branches: number; deposits: number }>();
  for (const r of rows) {
    const code = String(r.state);
    const s = byState.get(code) ?? { branches: 0, deposits: 0 };
    s.branches += num(r.branches);
    s.deposits += num(r.deposits) * 1_000;
    byState.set(code, s);
  }
  const cuRows = await part(
    async () =>
      (await sql.unsafe(
        `SELECT c.state, COUNT(*)::int AS branches
           FROM credit_union_branches c
          WHERE c.state = ANY($1::text[])
          GROUP BY 1`,
        [states],
      )) as unknown as Record<string, unknown>[],
    [] as Record<string, unknown>[],
  );
  const by_state = [...byState.entries()].map(([state_code, s]) => ({ state_code, ...s })).sort((a, b) => b.deposits - a.deposits);
  return {
    sod_year: num(rows[0].year),
    by_state,
    cu_by_state: cuRows.map((r) => ({ state_code: String(r.state), branches: num(r.branches) })),
    leaders: buildLeaders(rows),
    total_deposits: by_state.reduce((sum, s) => sum + s.deposits, 0),
  };
}

/**
 * Fee complaints for the latest full calendar year, for institutions whose CFPB company match
 * is accepted; an institution whose match awaits review has an unknown count and is left out.
 * Grouped by district and state nationwide (a few dozen rows) so the district reads against the U.S.
 */
async function loadComplaints(): Promise<HubComplaints | null> {
  const currentYear = String(new Date().getUTCFullYear());
  const rows = (await sql.unsafe(
    `WITH yr AS (
       SELECT MAX(report_period) AS p FROM institution_complaint_records WHERE report_period < $1
     ),
     matched AS (
       SELECT s.id, s.fed_district, s.state_code
         FROM institution_sources s
        WHERE EXISTS (
          SELECT 1 FROM institution_identity_links l
           WHERE l.institution_id = s.id AND l.link_type = 'cfpb_company' AND l.status = 'accepted'
        )
     ),
     dep AS (
       SELECT DISTINCT ON (f.institution_id) f.institution_id, f.total_deposits
         FROM institution_financial_records f
         JOIN matched m ON m.id = f.institution_id
        WHERE ${financialSourceFilter("f")}
          AND f.total_deposits > 0
          AND f.report_date >= ((SELECT p FROM yr) || '-01-01')
          AND f.report_date <= ((SELECT p FROM yr) || '-12-31')
        ORDER BY f.institution_id, f.report_date DESC
     ),
     comp AS (
       SELECT ic.institution_id,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ic.issue = '_total'), 0)::int AS total,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ${feeComplaintFilterSql("ic")}), 0)::int AS fee
         FROM institution_complaint_records ic
         JOIN matched m ON m.id = ic.institution_id
        WHERE ic.report_period = (SELECT p FROM yr)
        GROUP BY ic.institution_id
     )
     SELECT (SELECT p FROM yr) AS year, m.fed_district, m.state_code,
            COUNT(*)::int AS matched,
            COUNT(dep.institution_id)::int AS with_deposits,
            COALESCE(SUM(comp.fee), 0)::int AS fee_complaints,
            COALESCE(SUM(comp.total), 0)::int AS total_complaints,
            COALESCE(SUM(comp.fee) FILTER (WHERE dep.institution_id IS NOT NULL), 0)::int AS fee_complaints_rated,
            COALESCE(SUM(dep.total_deposits), 0) AS deposits
       FROM matched m
       LEFT JOIN dep ON dep.institution_id = m.id
       LEFT JOIN comp ON comp.institution_id = m.id
      GROUP BY 1, 2, 3`,
    [currentYear],
  )) as unknown as Record<string, unknown>[];
  const year = rows.find((r) => r.year)?.year;
  if (!year) return null;
  return {
    year: String(year),
    groups: rows.map((r) => ({
      fed_district: r.fed_district == null ? null : num(r.fed_district),
      state_code: r.state_code == null ? null : String(r.state_code).trim(),
      matched: num(r.matched),
      with_deposits: num(r.with_deposits),
      fee_complaints: num(r.fee_complaints),
      total_complaints: num(r.total_complaints),
      fee_complaints_rated: num(r.fee_complaints_rated),
      deposits: num(r.deposits),
    })),
  };
}

async function loadDemographics(states: string[]): Promise<HubDemographics[]> {
  const fipsToState = new Map(states.flatMap((code) => (STATE_TO_FIPS[code] ? [[STATE_TO_FIPS[code], code] as const] : [])));
  if (fipsToState.size === 0) return [];
  const rows = (await sql.unsafe(
    `SELECT DISTINCT ON (state_fips) state_fips, median_household_income, poverty_count, total_population, year
       FROM demographics
      WHERE geo_type = 'state' AND state_fips = ANY($1::text[])
      ORDER BY state_fips, year DESC`,
    [[...fipsToState.keys()]],
  )) as unknown as Record<string, unknown>[];
  const orNull = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return rows
    .filter((r) => fipsToState.has(String(r.state_fips)))
    .map((r) => ({
      state_code: fipsToState.get(String(r.state_fips))!,
      median_household_income: orNull(r.median_household_income),
      poverty_count: orNull(r.poverty_count),
      total_population: orNull(r.total_population),
      year: num(r.year),
    }));
}

const SERIES_POINTS = 72;

async function loadSeries(states: string[]): Promise<Record<string, IndicatorSeries>> {
  const ids = [...states.flatMap((s) => [`${s}UR`, `${s}NA`]), "UNRATE", CPI_BANK_SERVICES_SERIES];
  const rows = (await sql.unsafe(
    `SELECT series_id, observation_date, value
       FROM (
         SELECT series_id, observation_date, value,
                ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn
           FROM fed_economic_indicators
          WHERE series_id = ANY($1::text[]) AND value IS NOT NULL
       ) ranked
      WHERE rn <= $2
      ORDER BY series_id, observation_date DESC`,
    [ids, SERIES_POINTS],
  )) as unknown as { series_id: string; observation_date: unknown; value: unknown }[];
  const grouped = new Map<string, { observation_date: unknown; value: unknown }[]>();
  for (const row of rows) {
    const list = grouped.get(row.series_id) ?? [];
    list.push(row);
    grouped.set(row.series_id, list);
  }
  const out: Record<string, IndicatorSeries> = {};
  for (const [id, list] of grouped) {
    const series = buildIndicatorSeries(id, list);
    if (series) out[id] = series;
  }
  return out;
}

export async function getDistrictHub(district: number, now: Date = new Date()): Promise<DistrictHubData> {
  const states = districtStates(district);
  const since = new Date(now);
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  const sinceIso = since.toISOString().slice(0, 10);
  const [state_fees, institutions, revenue, branches, complaints, demographics, series, fee_changes] = await Promise.all([
    part(() => loadStateFees(district), [] as HubStateFees[]),
    part(() => loadInstitutions(district), [] as HubInstitutionGroup[]),
    part(() => loadRevenue(district, now), [] as HubRevenueRow[]),
    part(() => loadBranches(states), null),
    part(() => loadComplaints(), null),
    part(() => loadDemographics(states), [] as HubDemographics[]),
    part(() => loadSeries(states), {} as Record<string, IndicatorSeries>),
    part(() => getFeeChangeEvents({ fed_districts: [district], since: sinceIso, limit: FEE_CHANGE_LIMIT }), [] as FeeChangeEvent[]),
  ]);
  return {
    district,
    states,
    state_fees,
    institutions,
    revenue,
    branches,
    complaints,
    demographics,
    series,
    fee_changes,
    fee_changes_capped: fee_changes.length >= FEE_CHANGE_LIMIT,
    fee_changes_since: sinceIso,
  };
}

/** True when no part came back, so the public cache does not keep a failed read. */
export function isEmptyDistrictHub(hub: DistrictHubData): boolean {
  return hub.institutions.length === 0 && hub.state_fees.length === 0 && hub.revenue.length === 0 && !hub.branches;
}
