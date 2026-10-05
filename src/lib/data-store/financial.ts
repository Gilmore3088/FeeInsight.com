import { sql } from "./connection";

// Dollar amounts are stored in whole dollars (migration 023 + Phase 60.1
// ingest scaling). No query-layer multiplication needed.

const numOrNull = (v: unknown): number | null =>
  v !== null && v !== undefined ? Number(v) : null;

const dollarOrNull = numOrNull;

export { dollarOrNull as _dollarOrNull_FOR_TESTING };

export interface InstitutionFinancial {
  institution_id: number;
  report_date: string;
  source: string;
  total_assets: number | null;
  total_deposits: number | null;
  total_loans: number | null;
  service_charge_income: number | null;
  other_noninterest_income: number | null;
  net_interest_margin: number | null;
  efficiency_ratio: number | null;
  roa: number | null;
  roe: number | null;
  tier1_capital_ratio: number | null;
  branch_count: number | null;
  employee_count: number | null;
  member_count: number | null;
  total_revenue: number | null;
  fee_income_ratio: number | null;
  overdraft_revenue: number | null;
}

export interface FinancialStats {
  fdic_records: number;
  ncua_records: number;
  institutions_with_financials: number;
  complaint_records: number;
  institutions_with_complaints: number;
}

export interface ComplaintSummary {
  product: string;
  complaint_count: number;
}

export async function getFinancialStats(): Promise<FinancialStats> {
  const [fdic] = await sql`SELECT COUNT(*) as cnt FROM institution_financial_records WHERE source = 'fdic'`;
  const [ncua] = await sql`SELECT COUNT(*) as cnt FROM institution_financial_records WHERE source = 'ncua'`;
  const [instFin] = await sql`SELECT COUNT(DISTINCT institution_id) as cnt FROM institution_financial_records`;
  const [complaints] = await sql`SELECT COUNT(*) as cnt FROM institution_complaint_records`;
  const [instComp] = await sql`SELECT COUNT(DISTINCT institution_id) as cnt FROM institution_complaint_records`;

  return {
    fdic_records: Number((fdic as unknown as { cnt: number }).cnt),
    ncua_records: Number((ncua as unknown as { cnt: number }).cnt),
    institutions_with_financials: Number((instFin as unknown as { cnt: number }).cnt),
    complaint_records: Number((complaints as unknown as { cnt: number }).cnt),
    institutions_with_complaints: Number((instComp as unknown as { cnt: number }).cnt),
  };
}

export async function getFinancialsByInstitution(
  targetId: number,
  limit = 8,
): Promise<InstitutionFinancial[]> {
  const rowLimit = Math.min(Math.max(Math.floor(limit), 1), 40);
  const rows = [...await sql`
    SELECT institution_id, report_date, source,
           total_assets, total_deposits, total_loans,
           service_charge_income, other_noninterest_income,
           net_interest_margin, efficiency_ratio,
           roa, roe, tier1_capital_ratio,
           branch_count, employee_count, member_count,
           total_revenue, fee_income_ratio, overdraft_revenue
    FROM institution_financial_records
    WHERE institution_id = ${targetId}
    ORDER BY report_date DESC
    LIMIT ${rowLimit}`];

  return rows.map((r: Record<string, unknown>) => ({
    institution_id: Number(r.institution_id),
    report_date: r.report_date instanceof Date
      ? r.report_date.toISOString().slice(0, 10)
      : String(r.report_date),
    source: String(r.source),
    total_assets: dollarOrNull(r.total_assets),
    total_deposits: dollarOrNull(r.total_deposits),
    total_loans: dollarOrNull(r.total_loans),
    service_charge_income: dollarOrNull(r.service_charge_income),
    other_noninterest_income: dollarOrNull(r.other_noninterest_income),
    net_interest_margin: numOrNull(r.net_interest_margin),
    efficiency_ratio: numOrNull(r.efficiency_ratio),
    roa: numOrNull(r.roa),
    roe: numOrNull(r.roe),
    tier1_capital_ratio: numOrNull(r.tier1_capital_ratio),
    branch_count: numOrNull(r.branch_count),
    employee_count: numOrNull(r.employee_count),
    member_count: numOrNull(r.member_count),
    total_revenue: dollarOrNull(r.total_revenue),
    fee_income_ratio: numOrNull(r.fee_income_ratio),
    overdraft_revenue: dollarOrNull(r.overdraft_revenue),
  }));
}

export async function getComplaintsByInstitution(
  targetId: number
): Promise<ComplaintSummary[]> {
  const rows = await sql`
    SELECT product, complaint_count
    FROM institution_complaint_records
    WHERE institution_id = ${targetId} AND issue = '_total'
    ORDER BY complaint_count DESC`;
  return [...rows] as ComplaintSummary[];
}

// --- Market Concentration (SOD / HHI) ---

export interface MarketConcentration {
  msa_code: number;
  msa_name: string;
  total_deposits: number;
  institution_count: number;
  hhi: number;
  top3_share: number;
  year: number;
}

export async function getMarketConcentration(opts?: {
  year?: number;
  minInstitutions?: number;
  limit?: number;
  sort?: "hhi_desc" | "hhi_asc" | "deposits_desc";
}): Promise<MarketConcentration[]> {
  const year = opts?.year ?? 2024;
  const minInst = opts?.minInstitutions ?? 3;
  const limit = opts?.limit ?? 100;
  const orderBy =
    opts?.sort === "hhi_asc"
      ? "hhi ASC"
      : opts?.sort === "deposits_desc"
        ? "total_deposits DESC"
        : "hhi DESC";

  const rows = await sql.unsafe(
    `SELECT msa_code, msa_name, total_deposits, institution_count, hhi, top3_share, year
     FROM market_concentration
     WHERE year = $1 AND institution_count >= $2
     ORDER BY ${orderBy}
     LIMIT $3`,
    [year, minInst, limit]
  );
  return [...rows] as unknown as MarketConcentration[];
}

export async function getMarketConcentrationForInstitution(
  targetId: number,
  year?: number
): Promise<MarketConcentration | null> {
  const y = year ?? 2024;
  const [row] = await sql`
    SELECT mc.msa_code, mc.msa_name, mc.total_deposits,
           mc.institution_count, mc.hhi, mc.top3_share, mc.year
    FROM market_concentration mc
    JOIN institution_branch_deposits bd ON bd.msa_code = mc.msa_code AND bd.year = mc.year
    WHERE bd.institution_id = ${targetId} AND mc.year = ${y} AND bd.is_main_office = true
    LIMIT 1`;
  if (!row) return null;
  return {
    msa_code: Number(row.msa_code),
    msa_name: String(row.msa_name),
    total_deposits: Number(row.total_deposits),
    institution_count: Number(row.institution_count),
    hhi: Number(row.hhi),
    top3_share: Number(row.top3_share),
    year: Number(row.year),
  };
}

// --- Demographics (Census ACS) ---

export interface DemographicData {
  geo_id: string;
  geo_type: string;
  geo_name: string;
  state_fips: string | null;
  median_household_income: number | null;
  poverty_count: number | null;
  total_population: number | null;
  year: number;
}

export async function getStateDemographics(
  stateFips: string
): Promise<DemographicData | null> {
  const [row] = await sql`
    SELECT geo_id, geo_type, geo_name, state_fips,
           median_household_income, poverty_count, total_population, year
    FROM demographics
    WHERE geo_type = 'state' AND state_fips = ${stateFips}
    ORDER BY year DESC LIMIT 1`;
  return (row as DemographicData | undefined) ?? null;
}

export async function getCountyDemographics(
  stateFips: string
): Promise<DemographicData[]> {
  const rows = await sql`
    SELECT geo_id, geo_type, geo_name, state_fips,
           median_household_income, poverty_count, total_population, year
    FROM demographics
    WHERE geo_type = 'county' AND state_fips = ${stateFips}
    ORDER BY total_population DESC`;
  return [...rows] as DemographicData[];
}

// --- Economic Indicators (FRED / BLS / NY Fed / OFR) ---

export interface IndicatorObservation {
  series_id: string;
  series_title: string;
  fed_district: number | null;
  observation_date: string;
  value: number;
  units: string;
  frequency: string;
}

export async function getLatestIndicators(
  seriesIds: string[]
): Promise<IndicatorObservation[]> {
  if (seriesIds.length === 0) return [];
  const rows = await sql`
    SELECT e.series_id, e.series_title, e.fed_district,
           e.observation_date, e.value, e.units, e.frequency
    FROM fed_economic_indicators e
    INNER JOIN (
      SELECT series_id, MAX(observation_date) as max_date
      FROM fed_economic_indicators
      WHERE series_id IN ${sql(seriesIds)}
      GROUP BY series_id
    ) latest ON e.series_id = latest.series_id
             AND e.observation_date = latest.max_date`;
  return [...rows] as IndicatorObservation[];
}

export async function getIndicatorTimeSeries(
  seriesId: string,
  opts?: { fromDate?: string; limit?: number }
): Promise<IndicatorObservation[]> {
  const from = opts?.fromDate ?? "2020-01-01";
  const limit = opts?.limit ?? 500;
  const rows = await sql`
    SELECT series_id, series_title, fed_district,
           observation_date, value, units, frequency
    FROM fed_economic_indicators
    WHERE series_id = ${seriesId} AND observation_date >= ${from}
    ORDER BY observation_date DESC
    LIMIT ${limit}`;
  return [...rows] as IndicatorObservation[];
}

// --- CPI Context (BLS bank services vs overall CPI) ---

export interface CpiContext {
  bankFees: { date: string; value: number; yoyPct: number } | null;
  allItems: { date: string; value: number; yoyPct: number } | null;
}

export async function getCpiContext(): Promise<CpiContext> {
  const BANK_FEES = "CUUR0000SEMC01";
  const ALL_ITEMS = "CUUR0000SA0";

  async function getYoY(seriesId: string) {
    const rows = await sql`
      SELECT observation_date, value
      FROM fed_economic_indicators
      WHERE series_id = ${seriesId}
      ORDER BY observation_date DESC
      LIMIT 13` as { observation_date: string; value: number }[];

    if (rows.length < 13) return null;

    const latest = rows[0];
    const yearAgo = rows[12];
    const yoyPct = ((latest.value - yearAgo.value) / yearAgo.value) * 100;

    return {
      date: latest.observation_date,
      value: latest.value,
      yoyPct: Math.round(yoyPct * 10) / 10,
    };
  }

  return {
    bankFees: await getYoY(BANK_FEES),
    allItems: await getYoY(ALL_ITEMS),
  };
}

// --- Revenue Benchmarks (aggregated fee income ratios) ---

export interface RevenueIndex {
  report_date: string;
  institution_count: number;
  median_ratio: number | null;
  p25_ratio: number | null;
  p75_ratio: number | null;
  avg_service_charge: number | null;
}

export async function getRevenueIndexByDate(reportDate?: string): Promise<RevenueIndex | null> {
  let rows: { fee_income_ratio: number; service_charge_income: number | null }[];

  if (reportDate) {
    rows = await sql`
      SELECT fee_income_ratio, service_charge_income
      FROM institution_financial_records
      WHERE fee_income_ratio IS NOT NULL AND report_date = ${reportDate}
      ORDER BY fee_income_ratio` as typeof rows;
  } else {
    rows = await sql`
      SELECT fee_income_ratio, service_charge_income
      FROM institution_financial_records
      WHERE fee_income_ratio IS NOT NULL
        AND report_date = (SELECT MAX(report_date) FROM institution_financial_records)
      ORDER BY fee_income_ratio` as typeof rows;
  }

  if (rows.length === 0) return null;

  const ratios = rows.map((r) => r.fee_income_ratio);
  const n = ratios.length;
  const p25Idx = Math.floor(n * 0.25);
  const medIdx = Math.floor(n * 0.5);
  const p75Idx = Math.floor(n * 0.75);

  const svcCharges = rows
    .map((r) => r.service_charge_income)
    .filter((v): v is number => v !== null);
  const avgSvc = svcCharges.length > 0
    ? Math.round(svcCharges.reduce((a, b) => a + b, 0) / svcCharges.length)
    : null;

  let rd: string;
  if (reportDate) {
    rd = reportDate;
  } else {
    const [maxRow] = await sql`SELECT MAX(report_date) as d FROM institution_financial_records`;
    rd = (maxRow as { d: string }).d;
  }

  return {
    report_date: rd,
    institution_count: n,
    median_ratio: ratios[medIdx],
    p25_ratio: ratios[p25Idx],
    p75_ratio: ratios[p75Idx],
    avg_service_charge: avgSvc,
  };
}

// --- Data Coverage Summary ---

export interface DataCoverageSummary {
  fdic_financials: number;
  ncua_financials: number;
  cfpb_complaints: number;
  fred_indicators: number;
  bls_observations: number;
  nyfed_rates: number;
  ofr_stress: number;
  sod_branches: number;
  market_concentrations: number;
  demographics: number;
  census_tracts: number;
}

export async function getDataCoverageSummary(): Promise<DataCoverageSummary> {
  const count = async (query: string) => {
    const [row] = await sql.unsafe(query);
    return Number((row as unknown as { cnt: number }).cnt);
  };

  const [
    fdic_financials,
    ncua_financials,
    cfpb_complaints,
    fred_indicators,
    bls_observations,
    nyfed_rates,
    ofr_stress,
    sod_branches,
    market_concentrations,
    demographics,
    census_tracts,
  ] = await Promise.all([
    count("SELECT COUNT(*) as cnt FROM institution_financial_records WHERE source = 'fdic'"),
    count("SELECT COUNT(*) as cnt FROM institution_financial_records WHERE source = 'ncua'"),
    count("SELECT COUNT(*) as cnt FROM institution_complaint_records"),
    count("SELECT COUNT(*) as cnt FROM fed_economic_indicators WHERE series_id NOT LIKE 'NYFED_%' AND series_id NOT LIKE 'OFR_%' AND series_id NOT LIKE 'CU%'"),
    count("SELECT COUNT(*) as cnt FROM fed_economic_indicators WHERE series_id LIKE 'CU%'"),
    count("SELECT COUNT(*) as cnt FROM fed_economic_indicators WHERE series_id LIKE 'NYFED_%'"),
    count("SELECT COUNT(*) as cnt FROM fed_economic_indicators WHERE series_id LIKE 'OFR_%'"),
    count("SELECT COUNT(*) as cnt FROM institution_branch_deposits"),
    count("SELECT COUNT(*) as cnt FROM market_concentration"),
    count("SELECT COUNT(*) as cnt FROM demographics"),
    count("SELECT COUNT(*) as cnt FROM census_tracts"),
  ]);

  return {
    fdic_financials,
    ncua_financials,
    cfpb_complaints,
    fred_indicators,
    bls_observations,
    nyfed_rates,
    ofr_stress,
    sod_branches,
    market_concentrations,
    demographics,
    census_tracts,
  };
}

// --- SOD Market Share (FDIC Summary of Deposits) ---

export async function getSodMarketShare(stateFips?: string): Promise<{
  institution_name: string;
  state_fips: string;
  total_deposits: number | null;
  branch_count: number | null;
  year: number;
}[]> {
  type SodMarketShareRow = {
    institution_name: string;
    state_fips: string;
    total_deposits: number | null;
    branch_count: number | null;
    year: number;
  };

  try {
    if (stateFips) {
      return await sql`
        SELECT institution_name, state_fips, total_deposits, branch_count, year
        FROM sod_deposits
        WHERE state_fips = ${stateFips}
        ORDER BY total_deposits DESC NULLS LAST
        LIMIT 10
      ` as SodMarketShareRow[];
    }
    return await sql`
      SELECT institution_name, state_fips, total_deposits, branch_count, year
      FROM sod_deposits
      ORDER BY total_deposits DESC NULLS LAST
      LIMIT 10
    ` as SodMarketShareRow[];
  } catch {
    return [];
  }
}

// --- NY Fed Data ---

export async function getNyFedData(limit = 20): Promise<{
  series_id: string;
  series_title: string | null;
  observation_date: string;
  value: number | null;
  units: string | null;
}[]> {
  type NyFedDataRow = {
    series_id: string;
    series_title: string | null;
    observation_date: string;
    value: number | null;
    units: string | null;
  };

  try {
    return await sql`
      SELECT DISTINCT ON (series_id)
        series_id, series_title, observation_date, value, units
      FROM nyfed_data
      ORDER BY series_id, observation_date DESC
      LIMIT ${limit}
    ` as NyFedDataRow[];
  } catch {
    return [];
  }
}

// --- OFR Data (Office of Financial Research) ---

export async function getOfrData(limit = 20): Promise<{
  series_id: string;
  series_title: string | null;
  observation_date: string;
  value: number | null;
  description: string | null;
}[]> {
  type OfrDataRow = {
    series_id: string;
    series_title: string | null;
    observation_date: string;
    value: number | null;
    description: string | null;
  };

  try {
    return await sql`
      SELECT DISTINCT ON (series_id)
        series_id, series_title, observation_date, value, description
      FROM ofr_data
      ORDER BY series_id, observation_date DESC
      LIMIT ${limit}
    ` as OfrDataRow[];
  } catch {
    return [];
  }
}

// --- Financial history (regulatory registry) ---

/** Every call-report line the gated Financial profile charts, in stored units. */
export interface InstitutionFinancialHistoryRow extends InstitutionFinancial {
  net_income: number | null;
  net_interest_income: number | null;
  noninterest_expense: number | null;
  provision_for_losses: number | null;
  net_charge_offs: number | null;
  noncurrent_loans: number | null;
  total_equity: number | null;
  loans_real_estate: number | null;
  loans_commercial: number | null;
  loans_consumer: number | null;
  loans_agricultural: number | null;
  net_charge_off_rate: number | null;
  noncurrent_loan_rate: number | null;
  leverage_ratio: number | null;
  total_capital_ratio: number | null;
  fetched_at: string | null;
}

const HISTORY_EXTRA_NUMERIC = [
  "net_income",
  "net_interest_income",
  "noninterest_expense",
  "provision_for_losses",
  "net_charge_offs",
  "noncurrent_loans",
  "total_equity",
  "loans_real_estate",
  "loans_commercial",
  "loans_consumer",
  "loans_agricultural",
  "net_charge_off_rate",
  "noncurrent_loan_rate",
  "leverage_ratio",
  "total_capital_ratio",
] as const;

/**
 * Up to `maxQuarters` quarters of call-report history (all sources; callers pick
 * one row per quarter). Reads only columns added by the regulatory registry
 * migration, so it must only be called once that migration is applied; callers
 * wrap it with a fallback.
 */
export async function getFinancialHistory(
  targetId: number,
  maxQuarters = 68,
): Promise<InstitutionFinancialHistoryRow[]> {
  const rowLimit = Math.min(Math.max(Math.floor(maxQuarters), 1), 100) * 3;
  const rows = [...await sql`
    SELECT institution_id, report_date, source,
           total_assets, total_deposits, total_loans,
           service_charge_income, other_noninterest_income,
           net_interest_margin, efficiency_ratio,
           roa, roe, tier1_capital_ratio,
           branch_count, employee_count, member_count,
           total_revenue, fee_income_ratio, overdraft_revenue,
           net_income, net_interest_income, noninterest_expense, provision_for_losses,
           net_charge_offs, noncurrent_loans, total_equity,
           loans_real_estate, loans_commercial, loans_consumer, loans_agricultural,
           net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, total_capital_ratio,
           fetched_at
    FROM institution_financial_records
    WHERE institution_id = ${targetId}
    ORDER BY report_date DESC
    LIMIT ${rowLimit}`];

  return rows.map((r: Record<string, unknown>) => {
    const extra = Object.fromEntries(HISTORY_EXTRA_NUMERIC.map((key) => [key, numOrNull(r[key])]));
    return {
      institution_id: Number(r.institution_id),
      report_date: r.report_date instanceof Date ? r.report_date.toISOString().slice(0, 10) : String(r.report_date),
      source: String(r.source),
      total_assets: dollarOrNull(r.total_assets),
      total_deposits: dollarOrNull(r.total_deposits),
      total_loans: dollarOrNull(r.total_loans),
      service_charge_income: dollarOrNull(r.service_charge_income),
      other_noninterest_income: dollarOrNull(r.other_noninterest_income),
      net_interest_margin: numOrNull(r.net_interest_margin),
      efficiency_ratio: numOrNull(r.efficiency_ratio),
      roa: numOrNull(r.roa),
      roe: numOrNull(r.roe),
      tier1_capital_ratio: numOrNull(r.tier1_capital_ratio),
      branch_count: numOrNull(r.branch_count),
      employee_count: numOrNull(r.employee_count),
      member_count: numOrNull(r.member_count),
      total_revenue: dollarOrNull(r.total_revenue),
      fee_income_ratio: numOrNull(r.fee_income_ratio),
      overdraft_revenue: dollarOrNull(r.overdraft_revenue),
      ...extra,
      fetched_at: r.fetched_at instanceof Date ? r.fetched_at.toISOString() : r.fetched_at ? String(r.fetched_at) : null,
    } as InstitutionFinancialHistoryRow;
  });
}

/**
 * Service-charge income for every FDIC and NCUA quarter held since 2009, oldest first
 * (thousands of dollars; NCUA figures are year-to-date). Feeds the report trend analysis.
 */
export async function getServiceChargeHistory(
  targetId: number,
): Promise<Array<{ report_date: string; source: string; service_charge_income: number | null }>> {
  const rows = await sql`
    SELECT report_date, source, service_charge_income
      FROM institution_financial_records
     WHERE institution_id = ${targetId}
       AND source IN ('fdic', 'ncua')
       AND report_date >= '2009-01-01'
     ORDER BY report_date`;
  return rows.map((r: Record<string, unknown>) => ({
    report_date: r.report_date instanceof Date ? r.report_date.toISOString().slice(0, 10) : String(r.report_date),
    source: String(r.source),
    service_charge_income: numOrNull(r.service_charge_income),
  }));
}

/** Peer medians for the institution's charter + asset tier, latest common quarter. */
export interface PeerFinancialMedians {
  report_date: string;
  source: string;
  peer_count: number;
  roa: number | null;
  net_interest_margin: number | null;
  efficiency_ratio: number | null;
  net_charge_off_rate: number | null;
  noncurrent_loan_rate: number | null;
  tier1_capital_ratio: number | null;
  /** Fraction (fdic/ncua convention), e.g. 0.05 = 5%. */
  fee_income_ratio: number | null;
}

export async function getPeerFinancialMedians(targetId: number): Promise<PeerFinancialMedians | null> {
  const [row] = await sql`
    WITH me AS (
      SELECT s.charter_type, s.asset_size_tier, f.report_date, f.source
        FROM institution_sources s
        JOIN institution_financial_records f ON f.institution_id = s.id
       WHERE s.id = ${targetId} AND f.source IN ('fdic', 'ncua')
       ORDER BY f.report_date DESC
       LIMIT 1
    )
    SELECT me.report_date, me.source,
           COUNT(*)::int AS peer_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.roa) FILTER (WHERE f.roa <> 0) AS roa,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.net_interest_margin) AS net_interest_margin,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.efficiency_ratio)
             FILTER (WHERE f.efficiency_ratio BETWEEN 0 AND 200) AS efficiency_ratio,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.net_charge_off_rate) AS net_charge_off_rate,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.noncurrent_loan_rate) AS noncurrent_loan_rate,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.tier1_capital_ratio) AS tier1_capital_ratio,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY f.fee_income_ratio) AS fee_income_ratio
      FROM me
      JOIN institution_sources s
        ON s.charter_type = me.charter_type
       AND s.asset_size_tier IS NOT DISTINCT FROM me.asset_size_tier
      JOIN institution_financial_records f
        ON f.institution_id = s.id AND f.report_date = me.report_date AND f.source = me.source
     GROUP BY me.report_date, me.source`;
  if (!row) return null;
  return {
    report_date: String(row.report_date),
    source: String(row.source),
    peer_count: Number(row.peer_count),
    roa: numOrNull(row.roa),
    net_interest_margin: numOrNull(row.net_interest_margin),
    efficiency_ratio: numOrNull(row.efficiency_ratio),
    net_charge_off_rate: numOrNull(row.net_charge_off_rate),
    noncurrent_loan_rate: numOrNull(row.noncurrent_loan_rate),
    tier1_capital_ratio: numOrNull(row.tier1_capital_ratio),
    fee_income_ratio: numOrNull(row.fee_income_ratio),
  };
}
