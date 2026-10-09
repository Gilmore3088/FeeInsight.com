import { sql } from "./connection";

/**
 * Data behind the State Index report's charts: every institution's own fee for the featured
 * fees (one dot each), the overdraft fee at the branches in each county, and who holds the
 * state's deposits. Fees come from published_fee_catalog (dollar fees only); deposits from the
 * latest FDIC Summary of Deposits year in institution_branch_deposits.
 */

/** The fees the state report charts, in display order. */
export const STATE_CHART_FEES = [
  "overdraft",
  "nsf",
  "stop_payment",
  "wire_domestic_outgoing",
  "cashiers_check",
  "monthly_maintenance",
] as const;

export interface StateInstitutionFees {
  institution_id: number;
  name: string;
  charter: "bank" | "credit_union";
  /** Median published amount per fee category. */
  fees: Record<string, number>;
}

export interface CountyOverdraft {
  /** Five-digit county FIPS. */
  fips: string;
  /** Branch deposits in the county, in dollars. */
  deposits: number;
  /** Deposits at institutions with a published overdraft fee, in dollars. */
  covered_deposits: number;
  /** Deposit-weighted overdraft fee at those institutions; null when none has one. */
  overdraft: number | null;
  institutions: number;
}

export interface DepositHolder {
  institution_id: number;
  name: string;
  /** Headquarters state, when known. */
  hq_state: string | null;
  /** Deposits at branches in the state, in dollars. */
  deposits: number;
  branches: number;
  overdraft: number | null;
}

export interface StateVisualsData {
  sod_year: number | null;
  institutions: StateInstitutionFees[];
  counties: CountyOverdraft[];
  holders: DepositHolder[];
}

/** Summary of Deposits figures are stored in thousands of dollars. */
const SOD_THOUSANDS = 1000;
const HOLDERS = 12;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
};

/**
 * Each county's deposit-weighted fee for one category: every institution with branches there
 * counts with its own median published fee, wherever it is headquartered. A $0 reading is left
 * out of the weighting: it is a fee the institution does not charge, and the map shows what
 * customers pay where the fee exists.
 */
async function countyFeeRows(code: string, sodYear: number, feeCategory: string): Promise<CountyOverdraft[]> {
  const rows = await sql<{ fips: string; deposits: unknown; covered: unknown; weighted: unknown; institutions: unknown }[]>`
    WITH od AS (
      SELECT institution_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS amt
        FROM published_fee_catalog WHERE fee_category = ${feeCategory} AND amount > 0 GROUP BY institution_id
    ), b AS (
      SELECT lpad(d.county_fips::text, 5, '0') AS fips, d.institution_id, COALESCE(d.deposits, 0) AS deposits
        FROM institution_branch_deposits d
       WHERE d.state = ${code} AND d.year = ${sodYear} AND d.county_fips IS NOT NULL
    )
    SELECT b.fips, SUM(b.deposits) AS deposits,
           SUM(b.deposits) FILTER (WHERE od.amt IS NOT NULL) AS covered,
           SUM(od.amt * b.deposits) FILTER (WHERE od.amt IS NOT NULL)
             / NULLIF(SUM(b.deposits) FILTER (WHERE od.amt IS NOT NULL), 0) AS weighted,
           COUNT(DISTINCT b.institution_id) AS institutions
      FROM b LEFT JOIN od ON od.institution_id = b.institution_id
     GROUP BY b.fips`;
  return rows.map((r) => ({
    fips: String(r.fips),
    deposits: (num(r.deposits) ?? 0) * SOD_THOUSANDS,
    covered_deposits: (num(r.covered) ?? 0) * SOD_THOUSANDS,
    overdraft: num(r.weighted),
    institutions: num(r.institutions) ?? 0,
  }));
}

export interface CountyFeeMapData {
  sod_year: number | null;
  /** `overdraft` holds the weighted fee for the category asked for. */
  counties: CountyOverdraft[];
}

/** One fee category's county figures for a state, from the latest Summary of Deposits year. */
export async function getCountyFeeMap(stateCode: string, feeCategory: string): Promise<CountyFeeMapData> {
  const code = stateCode.toUpperCase();
  const yearRows = await sql<{ y: unknown }[]>`SELECT MAX(year) AS y FROM institution_branch_deposits WHERE state = ${code}`;
  const sodYear = num(yearRows[0]?.y);
  if (sodYear === null) return { sod_year: null, counties: [] };
  return { sod_year: sodYear, counties: await countyFeeRows(code, sodYear, feeCategory) };
}

export async function getStateVisualsData(stateCode: string): Promise<StateVisualsData> {
  const code = stateCode.toUpperCase();
  const fees = [...STATE_CHART_FEES];
  const [instRows, yearRows] = await Promise.all([
    sql<{ institution_id: number; name: string; charter_type: string | null; fee_category: string; amount: unknown }[]>`
      SELECT f.institution_id, s.institution_name AS name, s.charter_type, f.fee_category,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY f.amount) AS amount
        FROM published_fee_catalog f
        JOIN institution_sources s ON s.id = f.institution_id
       WHERE s.state_code = ${code} AND f.amount IS NOT NULL AND f.fee_category = ANY(${fees}::text[])
       GROUP BY f.institution_id, s.institution_name, s.charter_type, f.fee_category`,
    sql<{ y: unknown }[]>`SELECT MAX(year) AS y FROM institution_branch_deposits WHERE state = ${code}`,
  ]);

  const byInstitution = new Map<number, StateInstitutionFees>();
  for (const row of instRows) {
    const amount = num(row.amount);
    if (amount === null) continue;
    const id = Number(row.institution_id);
    const entry = byInstitution.get(id) ?? {
      institution_id: id,
      name: row.name,
      charter: row.charter_type === "credit_union" ? "credit_union" : "bank",
      fees: {},
    };
    entry.fees[row.fee_category] = amount;
    byInstitution.set(id, entry);
  }

  const sodYear = num(yearRows[0]?.y);
  if (sodYear === null) {
    return { sod_year: null, institutions: [...byInstitution.values()], counties: [], holders: [] };
  }

  const [countyRows, holderRows] = await Promise.all([
    countyFeeRows(code, sodYear, "overdraft"),
    sql<{ institution_id: number; name: string; hq_state: string | null; deposits: unknown; branches: unknown; overdraft: unknown }[]>`
      WITH t AS (
        SELECT institution_id, SUM(COALESCE(deposits, 0)) AS deposits, COUNT(*) AS branches
          FROM institution_branch_deposits
         WHERE state = ${code} AND year = ${sodYear} AND institution_id IS NOT NULL
         GROUP BY institution_id
      ), od AS (
        SELECT institution_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS amt
          FROM published_fee_catalog WHERE fee_category = 'overdraft' AND amount IS NOT NULL GROUP BY institution_id
      )
      SELECT t.institution_id, s.institution_name AS name, s.state_code AS hq_state, t.deposits, t.branches, od.amt AS overdraft
        FROM t JOIN institution_sources s ON s.id = t.institution_id
        LEFT JOIN od ON od.institution_id = t.institution_id
       ORDER BY t.deposits DESC
       LIMIT ${HOLDERS}`,
  ]);

  return {
    sod_year: sodYear,
    institutions: [...byInstitution.values()],
    counties: countyRows,
    holders: holderRows.map((r) => ({
      institution_id: Number(r.institution_id),
      name: r.name,
      hq_state: r.hq_state,
      deposits: (num(r.deposits) ?? 0) * SOD_THOUSANDS,
      branches: num(r.branches) ?? 0,
      overdraft: num(r.overdraft),
    })),
  };
}
