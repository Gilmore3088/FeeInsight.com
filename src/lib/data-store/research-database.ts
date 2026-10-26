import { getSql } from "./connection";
import { getRegistryFeedFreshness } from "./feed-freshness";
import { activeInstitutionFilter, scheduleGroupSql, scheduleKeysSql, statsRowFilter, type StatsInputRow } from "./fee-stats";
import { buildResearchAudit } from "@/lib/research-database/audit";
import type { ResearchAuditRow, ResearchCharter, ResearchFootprint, ResearchRequest } from "@/lib/research-database/types";
import { countyFips } from "@/lib/research-database/metrics";
import { areaRowServedSql, fedIndicatorServedSql } from "./struck-sources";

export interface ResearchInstitution { id: number; institution_name: string; charter_type: ResearchCharter; asset_size_tier: string | null }
export interface ResearchBranch { branch_key: string; county_fips: string | null; vintage: string; deposits: number | null; institution_id: number }
export interface ResearchDemographic { geo_id: string; geo_name: string | null; year: number; total_population: number | null; median_household_income: number | null }
export interface ResearchFinancial {
  institution_id: number; source: "fdic" | "ncua"; report_date: string; asset_size_tier: string | null;
  total_assets: number | null; total_deposits: number | null; total_loans: number | null; roa: number | null;
  prior_assets?: number | null; total_equity?: number | null;
}
export interface ResearchFee extends StatsInputRow { fee_category: string; charter_type: ResearchCharter; asset_size_tier: string | null }
export interface ResearchArea { source: string; series_key: string; geo_code: string; period: string; value: number | null; unit: string; source_url: string | null }
export interface ResearchLending { county_fips: string; activity_year: number; originations: number; lender_count: number; observation_count: number; source_url: string | null }
export interface ResearchMacro { series_id: string; observation_date: string; value: number | null; units: string | null }
export interface ResearchBranchSummary { vintage: string | null; branches: number; priced_branches: number; deposits: number | null; unmapped_branches: number }
export interface ResearchInputs {
  capturedAt: string;
  institutions: ResearchInstitution[];
  footprint: ResearchFootprint | null;
  branches: ResearchBranch[];
  demographics: ResearchDemographic[];
  financials: ResearchFinancial[];
  fees: ResearchFee[];
  areas: ResearchArea[];
  audit: ResearchAuditRow[];
  lending?: ResearchLending[];
  macro?: ResearchMacro[];
  previous?: { capturedAt: string; cells: import("@/lib/research-database/types").ResearchCell[] } | null;
  branchSummary?: ResearchBranchSummary | null;
}

/** Latest source-wide release, not each institution's last surviving office. Stale NCUA offices drop out.
 * County placements are accepted only for the exact current address, matching Hoovie's hash contract.
 */
export const RESEARCH_BRANCH_SQL = `
  SELECT 'bank:' || b.cert || ':' || b.branch_number AS branch_key, b.institution_id,
         lpad(b.county_fips::text, 5, '0') AS county_fips, b.year::text AS vintage,
         b.deposits * 1000.0 AS deposits
    FROM institution_branch_deposits b
   WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
  UNION ALL
  SELECT 'cu:' || b.charter || ':' || b.site_id, b.institution_id,
         CASE WHEN t.status IN ('matched', 'matched_coordinates')
               AND t.address_hash = md5(concat_ws('|', upper(b.address), upper(b.city), upper(b.state), left(b.zip, 5)))
              THEN t.county_fips END,
         b.report_date::text, NULL::numeric
    FROM credit_union_branches b
    LEFT JOIN branch_census_tracts t ON t.branch_kind = 'credit_union' AND t.branch_key = b.charter || ':' || b.site_id
   WHERE b.report_date = (SELECT MAX(report_date) FROM credit_union_branches)`;

export function buildResearchFootprint(institution: ResearchInstitution, branches: ResearchBranch[]): ResearchFootprint {
  const own = branches.filter(b => Number(b.institution_id) === Number(institution.id));
  const matched = own.filter(b => countyFips(b.county_fips) !== null);
  return {
    institutionId: Number(institution.id), name: institution.institution_name, charter: institution.charter_type,
    vintage: own[0]?.vintage ?? null,
    counties: [...new Set(matched.map(b => countyFips(b.county_fips)!))].sort(),
    branches: own.length, matchedBranches: matched.length, unmatchedBranches: own.length - matched.length,
    status: !matched.length ? "unavailable" : matched.length === own.length ? "available" : "partial",
  };
}

/** Consistent read-only snapshot. The only write is subsequently performed by the report run.
 * A source/table failure throws: a failed query never becomes a claim of no data.
 */
export async function loadResearchInputs(request: ResearchRequest, db = getSql()): Promise<ResearchInputs> {
  return db.begin("isolation level repeatable read read only", async transaction => {
    const tx = transaction as unknown as typeof db;
    const capturedAt = new Date().toISOString();
    const allInstitutions = await tx<ResearchInstitution[]>`
      SELECT id, institution_name, charter_type, asset_size_tier FROM institution_sources
       WHERE regulatory_status IS DISTINCT FROM 'inactive' AND charter_type IN ('bank', 'credit_union') ORDER BY id`;
    const subject = request.institutionId === null ? null : allInstitutions.find(i => Number(i.id) === request.institutionId);
    if (request.scope === "footprint" && !subject) throw new Error("Active institution not found.");
    // National research needs a bank-deposit fact, not every branch's address-level record.
    const allBranches = request.scope === "national" ? [] : await tx.unsafe<ResearchBranch[]>(RESEARCH_BRANCH_SQL);
    const [branchSummary] = request.scope === "national" && request.modules.includes("market") ? await tx<ResearchBranchSummary[]>`
      SELECT MAX(year)::text AS vintage, COUNT(*) FILTER (WHERE county_fips IS NOT NULL)::int AS branches,
             COUNT(*) FILTER (WHERE county_fips IS NOT NULL AND deposits IS NOT NULL)::int AS priced_branches,
             SUM(deposits) FILTER (WHERE county_fips IS NOT NULL) * 1000.0 AS deposits,
             COUNT(*) FILTER (WHERE county_fips IS NULL)::int AS unmapped_branches
        FROM institution_branch_deposits WHERE year=(SELECT MAX(year) FROM institution_branch_deposits)` : [];
    const footprint = subject ? buildResearchFootprint(subject, allBranches) : null;
    if (footprint?.status === "unavailable") throw new Error("Footprint unavailable: no current branch counties could be established.");
    const counties = footprint?.counties ?? [];
    const branches = footprint ? allBranches.filter(b => counties.includes(countyFips(b.county_fips) ?? "")) : allBranches;
    const marketIds = new Set(branches.map(b => Number(b.institution_id)));
    if (subject) marketIds.add(Number(subject.id));
    const institutions = footprint ? allInstitutions.filter(i => marketIds.has(Number(i.id))) : allInstitutions;
    const ids = institutions.map(i => Number(i.id));
    const demographics = request.modules.includes("market") ? await tx<ResearchDemographic[]>`
      SELECT geo_id, geo_name, year, total_population, median_household_income FROM demographics
       WHERE geo_type = 'county' AND year = (SELECT MAX(year) FROM demographics WHERE geo_type = 'county')
         AND (${request.scope === "national"} OR replace(geo_id, 'county:', '') = ANY(${counties}::text[])) ORDER BY geo_id` : [];
    const financials = request.modules.includes("performance") ? await tx<ResearchFinancial[]>`
      SELECT DISTINCT ON (f.institution_id, f.source) f.institution_id, f.source, f.report_date,
             s.asset_size_tier, f.total_assets, f.total_deposits, f.total_loans, f.roa, f.total_equity,
             (SELECT p.total_assets FROM institution_financial_records p
               WHERE p.institution_id = f.institution_id AND p.source = f.source AND p.source IN ('fdic', 'ncua')
                 AND p.report_date = to_char(f.report_date::date - INTERVAL '1 year', 'YYYY-MM-DD')
               ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1) AS prior_assets
        FROM institution_financial_records f JOIN institution_sources s ON s.id = f.institution_id
       WHERE f.source IN ('fdic', 'ncua') AND f.institution_id = ANY(${ids}::bigint[])
         AND ((f.source = 'fdic' AND s.charter_type = 'bank') OR (f.source = 'ncua' AND s.charter_type = 'credit_union'))
         AND f.report_date = (SELECT MAX(f2.report_date) FROM institution_financial_records f2 WHERE f2.source = f.source AND f2.source IN ('fdic', 'ncua'))
       ORDER BY f.institution_id, f.source, f.fetched_at DESC, f.id DESC` : [];
    // Shared statistics predicates and schedule keys are code constants; ids are bound parameters.
    const fees = request.modules.includes("fees") ? await tx.unsafe<ResearchFee[]>(`
      SELECT ef.institution_id, ef.amount, ef.fee_category, s.charter_type, s.asset_size_tier,
             ${scheduleKeysSql()} AS schedule_keys, ${scheduleGroupSql()} AS schedule_group
        FROM published_fee_catalog ef JOIN institution_sources s ON s.id = ef.institution_id
       WHERE ${statsRowFilter()} AND ${activeInstitutionFilter("s")}
         AND ef.institution_id = ANY($1::bigint[]) AND ef.fee_category = ANY($2::text[])
       ORDER BY ef.institution_id, ef.fee_category, ef.amount, ef.id`,
      [ids, ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"]]) : [];
    const areas = request.modules.includes("market") ? await tx<ResearchArea[]>`
      SELECT source, series_key, geo_code, period, value, unit, source_url FROM area_statistics a
       WHERE a.source = 'bls-qcew' AND a.series_key IN ('qcew_employment', 'qcew_establishments') AND a.geo_type = 'county'
         AND ${tx.unsafe(areaRowServedSql("a"))}
         AND a.period = (SELECT MAX(b.period) FROM area_statistics b WHERE b.source = a.source AND b.series_key = a.series_key AND b.geo_type = 'county')
         AND (${request.scope === "national"} OR a.geo_code = ANY(${counties}::text[]))
       ORDER BY source, series_key, geo_code` : [];
    const audit = buildResearchAudit(await getRegistryFeedFreshness(tx), new Date(capturedAt));
    const lending = request.modules.includes("market") ? await tx<ResearchLending[]>`
      SELECT county_fips, activity_year, SUM(originations)::bigint AS originations,
             COUNT(DISTINCT lei)::int AS lender_count, COUNT(*)::int AS observation_count,
             MIN(source_url) AS source_url FROM hmda_lender_originations
       WHERE activity_year = (SELECT MAX(activity_year) FROM hmda_lender_originations)
         AND county_fips IS NOT NULL
         AND (${request.scope === "national"} OR county_fips = ANY(${counties}::text[]))
       GROUP BY county_fips, activity_year ORDER BY county_fips` : [];
    // Unlike transitional readers, published research excludes every FRED-era fallback row.
    const macro = request.modules.includes("market") ? await tx<ResearchMacro[]>`
      SELECT DISTINCT ON (e.series_id) e.series_id, e.observation_date, e.value, e.units
        FROM fed_economic_indicators e
       WHERE e.series_id IN ('UNRATE', 'FEDFUNDS') AND e.fed_district IS NULL
         AND ${tx.unsafe(fedIndicatorServedSql("e"))}
         AND EXISTS (SELECT 1 FROM registry_ingest_partitions p WHERE p.source = 'fred' AND p.partition_key = 'current'
                      AND e.fetched_at >= NULLIF(p.detail->>'publisher_cutover_at', '')::timestamptz
                      AND p.detail->'publisher_series' ? e.series_id)
       ORDER BY e.series_id, e.observation_date DESC, e.fetched_at DESC` : [];
    const [prior] = await tx`
      SELECT data_manifest->'research_snapshot'->>'capturedAt' AS captured_at,
             data_manifest->'research_snapshot'->'cells' AS cells
        FROM report_jobs
       WHERE status = 'complete' AND params->>'edition' = 'research_v1'
         AND params->'research'->>'scope' = ${request.scope}
         AND params->'research'->>'cadence' = ${request.cadence}
         AND (params->'research'->>'institutionId') IS NOT DISTINCT FROM ${request.institutionId?.toString() ?? null}
         AND data_manifest->'research_verification'->>'verified' = 'true'
         AND EXISTS (SELECT 1 FROM published_reports p WHERE p.job_id = report_jobs.id AND p.is_public = true)
       ORDER BY completed_at DESC LIMIT 1`;
    const previous = prior ? { capturedAt: prior.captured_at, cells: prior.cells } : null;
    return JSON.parse(JSON.stringify({ capturedAt, institutions, footprint, branches, branchSummary: branchSummary ?? null, demographics, financials, fees, areas, audit, lending, macro, previous })) as ResearchInputs;
  }) as Promise<ResearchInputs>;
}

export async function getResearchReadiness() {
  return buildResearchAudit(await getRegistryFeedFreshness());
}

/** Exact profiling of the initial research tables. Each failed read remains a named failure. */
export async function getResearchTableProfiles(db = getSql()) {
  const profiles = [
    { table: "demographics", query: "SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE total_population IS NULL)::int AS missing, MIN(year)::text AS earliest, MAX(year)::text AS latest, (COUNT(*) - COUNT(DISTINCT (geo_id, geo_type, year)))::int AS duplicates FROM demographics WHERE geo_type = 'county'" },
    { table: "institution_financial_records", query: "SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE institution_id IS NULL OR total_assets IS NULL)::int AS missing, MIN(report_date) AS earliest, MAX(report_date) AS latest, (COUNT(*) - COUNT(DISTINCT (institution_id, source, report_date)))::int AS duplicates FROM institution_financial_records WHERE source IN ('fdic', 'ncua')" },
    { table: "institution_branch_deposits", query: "SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE institution_id IS NULL OR county_fips IS NULL)::int AS missing, MIN(year)::text AS earliest, MAX(year)::text AS latest, (COUNT(*) - COUNT(DISTINCT (cert, branch_number, year)))::int AS duplicates FROM institution_branch_deposits" },
    { table: "credit_union_branches", query: "SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE institution_id IS NULL)::int AS missing, MIN(report_date)::text AS earliest, MAX(report_date)::text AS latest, (COUNT(*) - COUNT(DISTINCT (charter, site_id)))::int AS duplicates FROM credit_union_branches" },
    { table: "area_statistics", query: "SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE value IS NULL)::int AS missing, MIN(period)::text AS earliest, MAX(period)::text AS latest, (COUNT(*) - COUNT(DISTINCT (source, geo_type, geo_code, period, series_key)))::int AS duplicates FROM area_statistics WHERE source = 'bls-qcew' AND geo_type = 'county'" },
  ];
  return Promise.all(profiles.map(async profile => {
    try { const [row] = await db.unsafe(profile.query); return { table: profile.table, ...row, error: null }; }
    catch (error) { return { table: profile.table, rows: null, missing: null, earliest: null, latest: null, duplicates: null, error: error instanceof Error ? error.message : "Read failed" }; }
  }));
}
