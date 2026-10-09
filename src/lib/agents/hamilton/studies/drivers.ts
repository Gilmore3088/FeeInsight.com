import type { SqlTag, StudySource } from "./common";

/**
 * Market drivers for the price studies, one value per institution, read from the
 * loaded registry data. Banks are weighted by branch deposits (FDIC Summary of
 * Deposits); credit unions, which have no branch deposits, weight each branch equally
 * (NCUA branch list). Credit union branches carry a ZIP but no county or metro, so the
 * ZIP is mapped to the county and metro most bank branches in that ZIP report.
 */

export interface DriverRead {
  values: Map<number, number>;
  sources: StudySource[];
  /** Data period the driver describes, for the study's sources line. */
  banks: number;
  creditUnions: number;
}

function toMap(rows: unknown): { values: Map<number, number>; banks: number; creditUnions: number } {
  const values = new Map<number, number>();
  let banks = 0;
  let creditUnions = 0;
  for (const r of rows as Array<{ institution_id: unknown; v: unknown; charter: string }>) {
    const v = Number(r.v);
    if (!Number.isFinite(v)) continue;
    values.set(Number(r.institution_id), v);
    if (r.charter === "bank") banks++;
    else creditUnions++;
  }
  return { values, banks, creditUnions };
}

async function periods(db: SqlTag): Promise<{ sodYear: number | null; cuBranchDate: string | null; incomeYear: number | null; hhiYear: number | null }> {
  const [row] = await db`
    SELECT (SELECT MAX(year) FROM institution_branch_deposits) AS sod_year,
           (SELECT MAX(report_date)::text FROM credit_union_branches) AS cu_date,
           (SELECT MAX(year) FROM demographics WHERE geo_type = 'county') AS income_year,
           (SELECT MAX(year) FROM market_concentration) AS hhi_year
  `;
  return {
    sodYear: row?.sod_year === null || row?.sod_year === undefined ? null : Number(row.sod_year),
    cuBranchDate: row?.cu_date ?? null,
    incomeYear: row?.income_year === null || row?.income_year === undefined ? null : Number(row.income_year),
    hhiYear: row?.hhi_year === null || row?.hhi_year === undefined ? null : Number(row.hhi_year),
  };
}

function branchSources(p: { sodYear: number | null; cuBranchDate: string | null }): StudySource[] {
  return [
    { name: "FDIC Summary of Deposits (bank branches and deposits)", asOf: p.sodYear === null ? null : String(p.sodYear) },
    { name: "NCUA credit union branch list", asOf: p.cuBranchDate },
  ];
}

/** Deposit-weighted (banks) or branch-averaged (credit unions) county median household income. */
export async function readLocalIncome(db: SqlTag): Promise<DriverRead> {
  const p = await periods(db);
  const rows = await db`
    WITH zip_geo AS (
      SELECT DISTINCT ON (LEFT(zip, 5)) LEFT(zip, 5) AS zip, county_fips
        FROM institution_branch_deposits
       WHERE year >= ${p.sodYear ?? 0}::int - 2 AND zip IS NOT NULL AND county_fips IS NOT NULL
       GROUP BY LEFT(zip, 5), county_fips
       ORDER BY LEFT(zip, 5), COUNT(*) DESC
    ), inc AS (
      SELECT state_fips || county_fips AS fips, median_household_income::float8 AS v
        FROM demographics
       WHERE geo_type = 'county' AND year = ${p.incomeYear ?? 0}::int AND median_household_income > 0
    ), bank AS (
      SELECT b.institution_id, SUM(b.deposits * i.v) / NULLIF(SUM(b.deposits), 0) AS v
        FROM institution_branch_deposits b
        JOIN inc i ON i.fips = LPAD(b.county_fips::text, 5, '0')
       WHERE b.year = ${p.sodYear ?? 0}::int AND b.deposits > 0 AND b.institution_id IS NOT NULL
       GROUP BY b.institution_id
    ), cu AS (
      SELECT c.institution_id, AVG(i.v) AS v
        FROM credit_union_branches c
        JOIN zip_geo z ON z.zip = LEFT(c.zip, 5)
        JOIN inc i ON i.fips = LPAD(z.county_fips::text, 5, '0')
       WHERE c.report_date = ${p.cuBranchDate}::date AND c.institution_id IS NOT NULL
       GROUP BY c.institution_id
    )
    SELECT institution_id, v, 'bank' AS charter FROM bank
    UNION ALL
    SELECT institution_id, v, 'credit_union' AS charter FROM cu
     WHERE institution_id NOT IN (SELECT institution_id FROM bank)
  `;
  return {
    ...toMap(rows),
    sources: [
      { name: "Census ACS county median household income", asOf: p.incomeYear === null ? null : String(p.incomeYear) },
      ...branchSources(p),
    ],
  };
}

/** Deposit-weighted (banks) or branch-averaged (credit unions) metro deposit HHI. Branches outside a metro drop out. */
export async function readMarketConcentration(db: SqlTag): Promise<DriverRead> {
  const p = await periods(db);
  const rows = await db`
    WITH zip_geo AS (
      SELECT DISTINCT ON (LEFT(zip, 5)) LEFT(zip, 5) AS zip, msa_code
        FROM institution_branch_deposits
       WHERE year >= ${p.sodYear ?? 0}::int - 2 AND zip IS NOT NULL AND msa_code IS NOT NULL AND msa_code <> 0
       GROUP BY LEFT(zip, 5), msa_code
       ORDER BY LEFT(zip, 5), COUNT(*) DESC
    ), hhi AS (
      SELECT msa_code, hhi::float8 AS v FROM market_concentration WHERE year = ${p.hhiYear ?? 0}::int AND hhi IS NOT NULL
    ), bank AS (
      SELECT b.institution_id, SUM(b.deposits * h.v) / NULLIF(SUM(b.deposits), 0) AS v
        FROM institution_branch_deposits b
        JOIN hhi h ON h.msa_code = b.msa_code
       WHERE b.year = ${p.sodYear ?? 0}::int AND b.deposits > 0 AND b.institution_id IS NOT NULL
       GROUP BY b.institution_id
    ), cu AS (
      SELECT c.institution_id, AVG(h.v) AS v
        FROM credit_union_branches c
        JOIN zip_geo z ON z.zip = LEFT(c.zip, 5)
        JOIN hhi h ON h.msa_code = z.msa_code
       WHERE c.report_date = ${p.cuBranchDate}::date AND c.institution_id IS NOT NULL
       GROUP BY c.institution_id
    )
    SELECT institution_id, v, 'bank' AS charter FROM bank
    UNION ALL
    SELECT institution_id, v, 'credit_union' AS charter FROM cu
     WHERE institution_id NOT IN (SELECT institution_id FROM bank)
  `;
  return {
    ...toMap(rows),
    sources: [
      { name: "Metro deposit concentration (HHI) from FDIC Summary of Deposits", asOf: p.hhiYear === null ? null : String(p.hhiYear) },
      ...branchSources(p),
    ],
  };
}

/**
 * Fee income as a share of deposits for the latest full year. Banks: service charges on
 * deposit accounts (four quarters summed, FDIC). Credit unions: total fee income (NCUA
 * account 131, December year to date), a broader line, so the study controls for charter.
 */
export async function readFeeIncomeShare(db: SqlTag): Promise<DriverRead & { year: number | null }> {
  const [yr] = await db`
    SELECT MAX(LEFT(report_date, 4)::int) AS y FROM institution_financial_records
     WHERE source IN ('fdic', 'ncua') AND report_date LIKE '%-12-31'
  `;
  const year = yr?.y === null || yr?.y === undefined ? null : Number(yr.y);
  const rows = await db`
    WITH bank AS (
      SELECT f.institution_id,
             SUM(f.service_charge_income)::float8 / NULLIF(MAX(f.total_deposits) FILTER (WHERE f.report_date = ${`${year}-12-31`}), 0) AS v,
             COUNT(*) FILTER (WHERE f.service_charge_income IS NOT NULL) AS quarters
        FROM institution_financial_records f
       WHERE f.source = 'fdic' AND f.institution_id IS NOT NULL AND LEFT(f.report_date, 4) = ${String(year)}
       GROUP BY f.institution_id
    ), cu AS (
      SELECT f.institution_id, f.service_charge_income::float8 / NULLIF(f.total_deposits, 0) AS v
        FROM institution_financial_records f
       WHERE f.source = 'ncua' AND f.institution_id IS NOT NULL AND f.report_date = ${`${year}-12-31`}
    )
    SELECT institution_id, v, 'bank' AS charter FROM bank WHERE quarters = 4 AND v >= 0
    UNION ALL
    SELECT institution_id, v, 'credit_union' AS charter FROM cu WHERE v >= 0
  `;
  return {
    ...toMap(rows),
    year,
    sources: [
      { name: "FDIC call reports: service charges on deposit accounts", asOf: year === null ? null : String(year) },
      { name: "NCUA 5300 call reports: fee income (account 131)", asOf: year === null ? null : String(year) },
    ],
  };
}
