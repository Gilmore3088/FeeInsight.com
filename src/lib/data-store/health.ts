import { sql } from "./connection";
import { financialSourceFilter } from "./financial-sources";
import type { RichIndicator } from "./fed";

export type { RichIndicator };

export interface IndustryHealthMetrics {
  roa: RichIndicator | null;
  roe: RichIndicator | null;
  efficiency_ratio: RichIndicator | null;
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

// Compute a RichIndicator from institution_financial_records for a given numeric column,
// aggregating per quarter (median across all institutions for that quarter).
async function buildHealthIndicator(
  column: "roa" | "roe" | "efficiency_ratio",
  quarterCount = 12
): Promise<RichIndicator | null> {
  try {
    const rows = await sql.unsafe(
      `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         MIN(inf.report_date::text)                                            AS quarter_date,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.${column})           AS median_value
       FROM institution_financial_records inf
       WHERE inf.${column} IS NOT NULL AND inf.${column} != 0
         AND ${financialSourceFilter("inf")}
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`,
      [quarterCount]
    ) as { quarter: string; quarter_date: string; median_value: number | string }[];

    if (rows.length === 0) return null;

    const history = rows.map((r) => ({
      date: r.quarter,
      value: Number(r.median_value),
    }));

    const current = history[0].value;
    const asOf = rows[0].quarter_date ?? history[0].date;

    let trend: "rising" | "falling" | "stable" = "stable";
    if (history.length >= 3) {
      const recent = history.slice(0, 3).reduce((s, h) => s + h.value, 0) / 3;
      const older = history.slice(-3).reduce((s, h) => s + h.value, 0) / 3;
      const delta = recent - older;
      const threshold = 0.05 * Math.abs(older || 1);
      trend = Math.abs(delta) < threshold ? "stable" : delta > 0 ? "rising" : "falling";
    }

    return { current, history, trend, asOf };
  } catch {
    return null;
  }
}

async function buildHealthIndicatorByCharter(
  column: "roa" | "roe" | "efficiency_ratio",
  charterType: "bank" | "credit_union"
): Promise<RichIndicator | null> {
  try {
    const rows = await sql.unsafe(
      `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         MIN(inf.report_date::text)                                            AS quarter_date,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.${column})           AS median_value
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.${column} IS NOT NULL AND inf.${column} != 0
         AND ${financialSourceFilter("inf")}
         AND ct.charter_type = $1
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT 8`,
      [charterType]
    ) as { quarter: string; quarter_date: string; median_value: number | string }[];

    if (rows.length === 0) return null;

    const history = rows.map((r) => ({
      date: r.quarter,
      value: Number(r.median_value),
    }));
    const current = history[0].value;
    const asOf = rows[0].quarter_date ?? history[0].date;

    let trend: "rising" | "falling" | "stable" = "stable";
    if (history.length >= 3) {
      const recent = history.slice(0, 3).reduce((s, h) => s + h.value, 0) / 3;
      const older = history.slice(-3).reduce((s, h) => s + h.value, 0) / 3;
      const delta = recent - older;
      const threshold = 0.05 * Math.abs(older || 1);
      trend = Math.abs(delta) < threshold ? "stable" : delta > 0 ? "rising" : "falling";
    }

    return { current, history, trend, asOf };
  } catch {
    return null;
  }
}

export async function getIndustryHealthMetrics(): Promise<IndustryHealthMetrics> {
  const [roa, roe, efficiency_ratio] = await Promise.all([
    buildHealthIndicator("roa"),
    buildHealthIndicator("roe"),
    buildHealthIndicator("efficiency_ratio"),
  ]);
  return { roa, roe, efficiency_ratio };
}

export async function getHealthMetricsByCharter(): Promise<HealthByCharter> {
  const [bankRoa, bankRoe, bankEff, cuRoa, cuRoe, cuEff] = await Promise.all([
    buildHealthIndicatorByCharter("roa", "bank"),
    buildHealthIndicatorByCharter("roe", "bank"),
    buildHealthIndicatorByCharter("efficiency_ratio", "bank"),
    buildHealthIndicatorByCharter("roa", "credit_union"),
    buildHealthIndicatorByCharter("roe", "credit_union"),
    buildHealthIndicatorByCharter("efficiency_ratio", "credit_union"),
  ]);

  return {
    bank: { roa: bankRoa, roe: bankRoe, efficiency_ratio: bankEff },
    credit_union: { roa: cuRoa, roe: cuRoe, efficiency_ratio: cuEff },
  };
}

async function buildGrowthTrend(
  column: "total_deposits" | "total_loans",
  quarterCount = 8
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
       WHERE inf.${column} IS NOT NULL AND inf.${column} > 0
         AND ${financialSourceFilter("inf")}
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`,
      [fetchCount]
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
  quarterCount = 8
): Promise<GrowthTrend | null> {
  return buildGrowthTrend("total_deposits", quarterCount);
}

export async function getLoanGrowthTrend(
  quarterCount = 8
): Promise<GrowthTrend | null> {
  return buildGrowthTrend("total_loans", quarterCount);
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
  quarterCount = 8
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
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`,
      [quarterCount]
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
