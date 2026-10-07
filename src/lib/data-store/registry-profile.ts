import { sql } from "./connection";

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
  return {
    source: "fdic_sod",
    latestYear,
    byYear: byYear.map((r) => ({ year: Number(r.year), branches: Number(r.branches), deposits: Number(r.deposits) })),
    byState: byState.map((r) => ({ state: r.state, branches: Number(r.branches), deposits: Number(r.deposits) })),
    topMarkets: topMarkets.map((r) => ({ msa_name: r.msa_name, branches: Number(r.branches), deposits: Number(r.deposits) })),
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
  const reportDate = dateStr(latest.report_date);
  const year = reportDate ? Number(reportDate.slice(0, 4)) : new Date().getUTCFullYear();
  return {
    source: "ncua",
    reportDate,
    latestYear: year,
    byYear: [{ year, branches: total, deposits: 0 }],
    byState: byState.map((r) => ({ state: r.state, branches: Number(r.branches), deposits: 0 })),
    topMarkets: topCities.map((r) => ({ msa_name: r.city, branches: Number(r.branches), deposits: 0 })),
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
