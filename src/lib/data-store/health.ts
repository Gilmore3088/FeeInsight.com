import { sql } from "./connection";
import { financialSourceFilter, type FinancialSource } from "./financial-sources";

export type { RichIndicator } from "./fed";

export interface HealthIndicator {
  current: number | null;
  history: { date: string; value: number | null; institution_count: number }[];
  trend: "rising" | "falling" | "stable" | "insufficient_data";
  asOf: string;
  minimum_median_count: number;
}

export interface IndustryHealthMetrics {
  roa: HealthIndicator | null;
  roe: HealthIndicator | null;
  efficiency_ratio: HealthIndicator | null;
}

export interface GrowthTrend {
  current_yoy_pct: number | null;
  history: { quarter: string; yoy_pct: number | null; absolute: number }[];
  trend: "rising" | "falling" | "stable";
  asOf: string;
}

export interface HealthByCharter {
  bank: IndustryHealthMetrics;
  credit_union: IndustryHealthMetrics;
}

// Source-scoped health medians, retaining actual counts and holding thin current periods.
async function buildHealthIndicator(
  column: "roa" | "roe" | "efficiency_ratio",
  quarterCount = 12,
  source?: FinancialSource
): Promise<HealthIndicator | null> {
  try {
    const rows = await sql.unsafe(
      `WITH recent_dates AS (
         SELECT DISTINCT report_date
         FROM institution_financial_records
         WHERE source IN ('fdic', 'ncua') AND ($2::text IS NULL OR source = $2)
         ORDER BY report_date DESC LIMIT $1
       )
       SELECT
         TO_CHAR(inf.report_date::date, 'YYYY-"Q"Q') AS quarter,
         inf.report_date::text AS quarter_date,
         COUNT(DISTINCT inf.institution_id)::int AS institution_count,
         CASE WHEN COUNT(DISTINCT inf.institution_id) >= 5
           THEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.${column}) END AS median_value
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.${column} IS NOT NULL AND inf.${column} != 0
         AND ${financialSourceFilter("inf")}
         AND ((ct.charter_type = 'bank' AND inf.source = 'fdic')
           OR (ct.charter_type = 'credit_union' AND inf.source = 'ncua'))
         AND ($2::text IS NULL OR inf.source = $2)
         AND inf.report_date IN (SELECT report_date FROM recent_dates)
       GROUP BY inf.report_date
       ORDER BY inf.report_date DESC
       LIMIT $1`,
      [quarterCount, source ?? null]
    ) as { quarter: string; quarter_date: string; institution_count: number | string; median_value: number | string | null }[];

    if (rows.length === 0) return null;

    const history = rows.map((r) => ({
      date: r.quarter,
      value: Number(r.institution_count) >= 5 && r.median_value !== null ? Number(r.median_value) : null,
      institution_count: Number(r.institution_count),
    }));

    const current = history[0].value;
    const asOf = rows[0].quarter_date ?? history[0].date;

    let trend: HealthIndicator["trend"] = "insufficient_data";
    if (history.length >= 3 && history.every((h) => h.value !== null)) {
      const recent = history.slice(0, 3).reduce((s, h) => s + (h.value ?? 0), 0) / 3;
      const older = history.slice(-3).reduce((s, h) => s + (h.value ?? 0), 0) / 3;
      const delta = recent - older;
      const threshold = 0.05 * Math.abs(older || 1);
      trend = Math.abs(delta) < threshold ? "stable" : delta > 0 ? "rising" : "falling";
    }

    return { current, history, trend, asOf, minimum_median_count: 5 };
  } catch {
    return null;
  }
}

async function buildHealthIndicatorByCharter(
  column: "roa" | "roe" | "efficiency_ratio",
  charterType: "bank" | "credit_union"
): Promise<HealthIndicator | null> {
  return buildHealthIndicator(column, 8, charterType === "bank" ? "fdic" : "ncua");
}

export async function getIndustryHealthMetrics(source?: FinancialSource): Promise<IndustryHealthMetrics> {
  const [roa, roe, efficiency_ratio] = await Promise.all([
    buildHealthIndicator("roa", 12, source),
    buildHealthIndicator("roe", 12, source),
    buildHealthIndicator("efficiency_ratio", 12, source),
  ]);
  return { roa, roe, efficiency_ratio };
}

export async function getHealthMetricsByCharter(source?: FinancialSource): Promise<HealthByCharter> {
  const [bankRoa, bankRoe, bankEff, cuRoa, cuRoe, cuEff] = await Promise.all([
    buildHealthIndicatorByCharter("roa", "bank"),
    buildHealthIndicatorByCharter("roe", "bank"),
    buildHealthIndicatorByCharter("efficiency_ratio", "bank"),
    buildHealthIndicatorByCharter("roa", "credit_union"),
    buildHealthIndicatorByCharter("roe", "credit_union"),
    buildHealthIndicatorByCharter("efficiency_ratio", "credit_union"),
  ]);

  return {
    bank: source === "ncua" ? { roa: null, roe: null, efficiency_ratio: null } : { roa: bankRoa, roe: bankRoe, efficiency_ratio: bankEff },
    credit_union: source === "fdic" ? { roa: null, roe: null, efficiency_ratio: null } : { roa: cuRoa, roe: cuRoe, efficiency_ratio: cuEff },
  };
}

async function buildGrowthTrend(
  column: "total_deposits" | "total_loans",
  quarterCount = 8,
  source?: FinancialSource
): Promise<GrowthTrend | null> {
  try {
    // Fetch quarterCount + 4 so we can compute YoY for each quarter
    const fetchCount = quarterCount + 4;
    const rows = await sql.unsafe(
      `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         MIN(inf.report_date::text)                                            AS quarter_date,
         SUM(inf.${column})                                                    AS absolute
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.${column} IS NOT NULL AND inf.${column} > 0
         AND ${financialSourceFilter("inf")}
         AND ((ct.charter_type = 'bank' AND inf.source = 'fdic')
           OR (ct.charter_type = 'credit_union' AND inf.source = 'ncua'))
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`,
      [fetchCount, source ?? null]
    ) as { quarter: string; quarter_date: string; absolute: number | string }[];

    if (rows.length === 0) return null;

    const parsed = rows.map((r) => ({
      quarter: r.quarter,
      absolute: Number(r.absolute),
      quarter_date: r.quarter_date,
    }));

    // Compute YoY for each quarter (compare idx to idx+4)
    const history: GrowthTrend["history"] = [];
    for (let i = 0; i < Math.min(parsed.length, quarterCount); i++) {
      const priorIdx = i + 4;
      let yoy_pct: number | null = null;
      if (priorIdx < parsed.length) {
        const current = parsed[i].absolute;
        const prior = parsed[priorIdx].absolute;
        if (prior > 0) {
          yoy_pct = ((current - prior) / prior) * 100;
        }
      }
      history.push({ quarter: parsed[i].quarter, yoy_pct, absolute: parsed[i].absolute });
    }

    const current_yoy_pct = history[0]?.yoy_pct ?? null;
    const asOf = parsed[0].quarter_date ?? parsed[0].quarter;

    let trend: "rising" | "falling" | "stable" = "stable";
    const validYoys = history.filter((h) => h.yoy_pct !== null).map((h) => h.yoy_pct as number);
    if (validYoys.length >= 2) {
      const delta = validYoys[0] - validYoys[validYoys.length - 1];
      trend = Math.abs(delta) < 0.5 ? "stable" : delta > 0 ? "rising" : "falling";
    }

    return { current_yoy_pct, history, trend, asOf };
  } catch {
    return null;
  }
}

export async function getDepositGrowthTrend(
  quarterCount = 8,
  source?: FinancialSource
): Promise<GrowthTrend | null> {
  return buildGrowthTrend("total_deposits", quarterCount, source);
}

export async function getLoanGrowthTrend(
  quarterCount = 8,
  source?: FinancialSource
): Promise<GrowthTrend | null> {
  return buildGrowthTrend("total_loans", quarterCount, source);
}

export interface InstitutionCountTrend {
  quarter: string;
  bank_count: number;
  cu_count: number;
  total: number;
  bank_change_pct: number | null;
  cu_change_pct: number | null;
}

// Returns quarterly counts of active institutions by charter type with QoQ change percentages.
// "Active" = at least one filing in institution_financial_records for that quarter.
// Per D-02: "Count distinct institutions with filings per quarter. No filing = presumed inactive."
export async function getInstitutionCountTrends(
  quarterCount = 8,
  source?: FinancialSource
): Promise<InstitutionCountTrend[]> {
  try {
    const rows = await sql.unsafe(
      `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'bank' THEN inf.institution_id END)         AS bank_count,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'credit_union' THEN inf.institution_id END) AS cu_count
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE ${financialSourceFilter("inf")}
         AND ((ct.charter_type = 'bank' AND inf.source = 'fdic')
           OR (ct.charter_type = 'credit_union' AND inf.source = 'ncua'))
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`,
      [quarterCount, source ?? null]
    ) as { quarter: string; bank_count: number | string; cu_count: number | string }[];

    if (rows.length === 0) return [];

    const parsed = rows.map((r) => ({
      quarter: r.quarter,
      bank_count: Number(r.bank_count),
      cu_count: Number(r.cu_count),
    }));

    // Compute quarter-over-quarter change_pct for each row (compare index i to index i+1)
    return parsed.map((row, i) => {
      const prior = parsed[i + 1];
      let bank_change_pct: number | null = null;
      let cu_change_pct: number | null = null;

      if (prior) {
        if (prior.bank_count > 0) {
          bank_change_pct = ((row.bank_count - prior.bank_count) / prior.bank_count) * 100;
        }
        if (prior.cu_count > 0) {
          cu_change_pct = ((row.cu_count - prior.cu_count) / prior.cu_count) * 100;
        }
      }

      return {
        quarter: row.quarter,
        bank_count: row.bank_count,
        cu_count: row.cu_count,
        total: row.bank_count + row.cu_count,
        bank_change_pct,
        cu_change_pct,
      };
    });
  } catch {
    return [];
  }
}
