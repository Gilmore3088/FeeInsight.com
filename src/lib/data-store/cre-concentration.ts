import { sql } from "@/lib/data-store/connection";
import { groupExpression, MIN_GROUP, type CallItemGroup } from "./call-report-items";

/**
 * Commercial real estate concentration, as far as the data already loaded allows. Server only.
 *
 * What regulators measure (2006 interagency CRE guidance): CRE loans excluding owner-occupied
 * nonfarm nonresidential, divided by total risk-based capital (watch at 300% with 50% growth over
 * 36 months), and construction and land development loans / total risk-based capital (100%).
 *
 * What is loaded today (institution_financial_records, source 'fdic', from FDIC BankFind):
 *   loans_real_estate  LNRE, ALL loans secured by real estate, including 1-4 family residential,
 *                      home equity and farmland (thousands)
 *   total_equity       EQTOT, total equity capital (thousands)
 *   total_loans        LNLSNET
 *   total_capital_ratio / tier1_capital_ratio / leverage_ratio (percent ratios only)
 *
 * So the figure here is a PROXY and an upper bound: all real estate loans / total equity capital.
 * It overstates CRE (residential and farmland are in the numerator) and uses equity instead of
 * total risk-based capital (which adds the allowance and tier 2 and deducts goodwill and other
 * intangibles). It is useful to rank a peer set, not to say whether a bank crosses 300%.
 *
 * Missing for the real ratio (none of these is loaded; each is an FDIC BankFind financial field
 * that would have to be added to FDIC_FINANCIAL_FIELDS in src/lib/regulatory/fdic.ts):
 *   LNRECONS  construction and land development loans
 *   LNREMULT  multifamily residential loans
 *   LNRENRES  nonfarm nonresidential loans (and the owner-occupied / other split, LNRENROW / LNRENROT)
 *   RBCT1J + RBCT2 (or total risk-based capital directly) and RWAJT risk-weighted assets
 * Field names are from memory of BankFind's financial dictionary and must be checked against it.
 * Credit unions are left out: NCUA 5300 commercial real estate lines are not loaded either.
 */

export const CRE_PROXY_BASIS =
  "All real estate loans (FDIC LNRE) / total equity capital (EQTOT): an upper-bound proxy. It includes 1-4 family residential and farmland and uses equity, not total risk-based capital.";

export const CRE_MISSING_FIELDS = [
  "LNRECONS (construction and land development loans)",
  "LNREMULT (multifamily residential loans)",
  "LNRENRES / LNRENROW / LNRENROT (nonfarm nonresidential, owner-occupied vs other)",
  "Total risk-based capital in dollars (RBCT1J + RBCT2) and risk-weighted assets (RWAJT)",
] as const;

export interface CreProxyInput {
  loans_real_estate: number | null;
  total_equity: number | null;
  total_loans: number | null;
}

export interface CreProxy {
  /** All real estate loans / total equity, percent; null without both or with equity <= 0. */
  re_loans_to_equity_pct: number | null;
  /** All real estate loans / net loans and leases, percent. */
  re_share_of_loans_pct: number | null;
}

/** Pure: the proxy ratios; nothing is filled when an input is blank. */
export function creProxy(row: CreProxyInput): CreProxy {
  const re = row.loans_real_estate;
  const eq = row.total_equity;
  const loans = row.total_loans;
  return {
    re_loans_to_equity_pct: re !== null && eq !== null && eq > 0 ? Number(((re / eq) * 100).toFixed(1)) : null,
    re_share_of_loans_pct: re !== null && loans !== null && loans > 0 ? Number(((re / loans) * 100).toFixed(1)) : null,
  };
}

/** Pure: change in the proxy over a window, percentage points; null without both ends. */
export function proxyChange(latest: number | null, prior: number | null): number | null {
  return latest === null || prior === null ? null : Number((latest - prior).toFixed(1));
}

export interface InstitutionCreConcentration extends CreProxy {
  report_date: string | null;
  loans_real_estate: number | null;
  total_equity: number | null;
  total_capital_ratio: number | null;
  /** The same proxy 12 quarters (36 months) earlier, and its change. */
  report_date_3y_ago: string | null;
  re_loans_to_equity_pct_3y_ago: number | null;
  change_3y_pp: number | null;
  /** Growth in all real estate loans over 36 months, percent (the guidance's 50% test uses CRE only). */
  re_loan_growth_3y_pct: number | null;
  basis: string;
  missing: readonly string[];
}

/** One bank's latest proxy with its value 36 months earlier. */
export async function getCreConcentration(institutionId: number): Promise<InstitutionCreConcentration> {
  const rows = await sql<Array<{ report_date: string; loans_real_estate: number | null; total_equity: number | null; total_loans: number | null; total_capital_ratio: number | null }>>`
    SELECT report_date, loans_real_estate::float8 AS loans_real_estate, total_equity::float8 AS total_equity,
           total_loans::float8 AS total_loans, total_capital_ratio
      FROM institution_financial_records
     WHERE institution_id = ${institutionId} AND source = 'fdic'
     ORDER BY report_date DESC
     LIMIT 13
  `;
  const list = [...rows].map((r) => ({
    ...r,
    loans_real_estate: r.loans_real_estate === null ? null : Number(r.loans_real_estate),
    total_equity: r.total_equity === null ? null : Number(r.total_equity),
    total_loans: r.total_loans === null ? null : Number(r.total_loans),
  }));
  const latest = list[0] ?? null;
  const prior = list[12] ?? null;
  const now = latest ? creProxy(latest) : { re_loans_to_equity_pct: null, re_share_of_loans_pct: null };
  const then = prior ? creProxy(prior) : null;
  const growth =
    latest?.loans_real_estate != null && prior?.loans_real_estate != null && prior.loans_real_estate > 0
      ? Number((((latest.loans_real_estate - prior.loans_real_estate) / prior.loans_real_estate) * 100).toFixed(1))
      : null;
  return {
    ...now,
    report_date: latest?.report_date ?? null,
    loans_real_estate: latest?.loans_real_estate ?? null,
    total_equity: latest?.total_equity ?? null,
    total_capital_ratio: latest?.total_capital_ratio ?? null,
    report_date_3y_ago: prior?.report_date ?? null,
    re_loans_to_equity_pct_3y_ago: then?.re_loans_to_equity_pct ?? null,
    change_3y_pp: proxyChange(now.re_loans_to_equity_pct, then?.re_loans_to_equity_pct ?? null),
    re_loan_growth_3y_pct: growth,
    basis: CRE_PROXY_BASIS,
    missing: CRE_MISSING_FIELDS,
  };
}

/** Median proxy per group for one report date (newest loaded when omitted), with bank counts. */
export async function getCreConcentrationByGroup(groupBy: CallItemGroup, reportDate?: string) {
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<Array<{ group_value: string | null; report_date: string; banks: number; median_re_to_equity_pct: number | null; p75_re_to_equity_pct: number | null }>>`
    WITH d AS (
      SELECT COALESCE(${reportDate ?? null}::text, (SELECT MAX(report_date) FROM institution_financial_records WHERE source = 'fdic')) AS report_date
    ), r AS (
      SELECT f.institution_id, f.report_date, f.loans_real_estate::float8 / f.total_equity::float8 * 100 AS ratio
        FROM institution_financial_records f, d
       WHERE f.source = 'fdic' AND f.report_date = d.report_date
         AND f.loans_real_estate IS NOT NULL AND f.total_equity > 0
    )
    SELECT ${group} AS group_value, MAX(r.report_date) AS report_date, COUNT(*)::int AS banks,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY r.ratio)::float8 END AS median_re_to_equity_pct,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.75) WITHIN GROUP (ORDER BY r.ratio)::float8 END AS p75_re_to_equity_pct
      FROM r JOIN institution_sources s ON s.id = r.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return { basis: CRE_PROXY_BASIS, missing: CRE_MISSING_FIELDS, groups: [...rows] };
}
