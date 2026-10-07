import { sql } from "./connection";

type SqlTag = typeof sql;

/**
 * Market leaders: the institutions that set prices in each state (James, 7 Oct 2026: "the
 * top 10, 15 largest institutions across every state ... probably have pricing power").
 * An institution leads a state when it ranks in the top MARKET_LEADERS_PER_STATE there by
 * any of three measures:
 *
 * - in-state deposits: banks from the latest FDIC branch survey year, summed by state;
 *   credit unions from their latest NCUA total deposits, counted in their home state
 *   (NCUA does not split deposits by state);
 * - service charge income and total income for the latest full calendar year: FDIC rows
 *   are quarterly and are summed, NCUA rows are year-to-date so the year-end row is the
 *   year. A bank's income is split across states by its deposit share there.
 *
 * Only fdic and ncua rows are read: they share one scale (thousands of dollars); ffiec
 * rows do not (call-reports.ts). Amounts returned are in thousands of dollars.
 */
export const MARKET_LEADERS_PER_STATE = 15;

export interface MarketLeader {
  state_code: string;
  institution_id: number;
  deposits: number | null;
  service_charge_income: number | null;
  total_income: number | null;
  deposit_rank: number;
  service_charge_rank: number;
  total_income_rank: number;
}

export interface MarketLeaderOptions {
  db?: SqlTag;
  perState?: number;
  /** One state's leaders; all states when null or left out. */
  stateCode?: string | null;
}

export async function getMarketLeaders(options: MarketLeaderOptions = {}): Promise<MarketLeader[]> {
  const db = options.db ?? sql;
  const perState = options.perState ?? MARKET_LEADERS_PER_STATE;
  const stateCode = options.stateCode ? options.stateCode.trim().toUpperCase() : null;
  const rows = await db<MarketLeader[]>`
    -- market leaders by state
    WITH income_year AS (
      SELECT max(left(report_date::text, 4))::int AS year
        FROM institution_financial_records
       WHERE source IN ('fdic', 'ncua') AND report_date::text LIKE '%-12-31'
    ),
    income AS (
      SELECT f.institution_id,
             CASE WHEN f.source = 'ncua' THEN max(f.service_charge_income) FILTER (WHERE f.report_date::text LIKE '%-12-31')
                  ELSE sum(f.service_charge_income) END AS service_charge_income,
             CASE WHEN f.source = 'ncua' THEN max(f.total_revenue) FILTER (WHERE f.report_date::text LIKE '%-12-31')
                  ELSE sum(f.total_revenue) END AS total_income
        FROM institution_financial_records f, income_year
       WHERE f.source IN ('fdic', 'ncua')
         AND left(f.report_date::text, 4)::int = income_year.year
       GROUP BY f.institution_id, f.source
    ),
    branch_year AS (SELECT max(year) AS year FROM institution_branch_deposits),
    bank_deposits AS (
      SELECT upper(btrim(b.state)) AS state_code, b.institution_id, sum(b.deposits)::numeric AS deposits
        FROM institution_branch_deposits b, branch_year
       WHERE b.year = branch_year.year AND b.institution_id IS NOT NULL AND b.state IS NOT NULL
       GROUP BY 1, 2
    ),
    by_state AS (
      SELECT d.state_code, d.institution_id, d.deposits,
             income.service_charge_income * d.deposits / NULLIF(sum(d.deposits) OVER (PARTITION BY d.institution_id), 0) AS service_charge_income,
             income.total_income * d.deposits / NULLIF(sum(d.deposits) OVER (PARTITION BY d.institution_id), 0) AS total_income
        FROM bank_deposits d
        JOIN institution_sources inst ON inst.id = d.institution_id
        LEFT JOIN income ON income.institution_id = d.institution_id
       WHERE COALESCE(inst.regulatory_status, 'active') <> 'inactive'
      UNION ALL
      SELECT upper(btrim(inst.state_code)), inst.id, latest.total_deposits::numeric,
             income.service_charge_income, income.total_income
        FROM institution_sources inst
        JOIN LATERAL (
          SELECT f.total_deposits FROM institution_financial_records f
           WHERE f.institution_id = inst.id AND f.source = 'ncua' AND f.total_deposits IS NOT NULL
           ORDER BY f.report_date DESC LIMIT 1
        ) latest ON true
        LEFT JOIN income ON income.institution_id = inst.id
       WHERE inst.charter_type = 'credit_union'
         AND COALESCE(inst.regulatory_status, 'active') <> 'inactive'
         AND inst.state_code IS NOT NULL
    ),
    ranked AS (
      SELECT by_state.*,
             row_number() OVER (PARTITION BY state_code ORDER BY deposits DESC NULLS LAST, institution_id) AS deposit_rank,
             row_number() OVER (PARTITION BY state_code ORDER BY service_charge_income DESC NULLS LAST, institution_id) AS service_charge_rank,
             row_number() OVER (PARTITION BY state_code ORDER BY total_income DESC NULLS LAST, institution_id) AS total_income_rank
        FROM by_state
    )
    SELECT state_code, institution_id, deposits, service_charge_income, total_income,
           deposit_rank, service_charge_rank, total_income_rank
      FROM ranked
     WHERE (deposit_rank <= ${perState} OR service_charge_rank <= ${perState} OR total_income_rank <= ${perState})
       AND (${stateCode}::text IS NULL OR state_code = ${stateCode}::text)
     ORDER BY state_code, deposit_rank
  `;
  return rows.map((row) => ({
    state_code: String(row.state_code),
    institution_id: Number(row.institution_id),
    deposits: row.deposits == null ? null : Number(row.deposits),
    service_charge_income: row.service_charge_income == null ? null : Number(row.service_charge_income),
    total_income: row.total_income == null ? null : Number(row.total_income),
    deposit_rank: Number(row.deposit_rank),
    service_charge_rank: Number(row.service_charge_rank),
    total_income_rank: Number(row.total_income_rank),
  }));
}

/**
 * Ids of institutions that lead a state (or the one state asked for) by any measure, each
 * once, for `inst.id = ANY(${ids}::bigint[])` in Atlas and Magellan.
 */
export async function loadMarketLeaderIds(
  db: SqlTag = sql,
  options: { stateCode?: string | null; perState?: number } = {},
): Promise<number[]> {
  const leaders = await getMarketLeaders({ db, ...options });
  return [...new Set(leaders.map((leader) => leader.institution_id))].sort((a, b) => a - b);
}
