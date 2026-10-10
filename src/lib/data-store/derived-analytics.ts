import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ConcentrationEntry {
  fee_category: string;
  value: number;
  pct_of_total: number;
}

export interface RevenueConcentration {
  dollar_volume: ConcentrationEntry[];
  institution_prevalence: ConcentrationEntry[];
  summary: {
    top_n: number;
    dollar_volume_pct: number;
    prevalence_pct: number;
    total_fee_dollars: number;
    total_institutions: number;
  };
}

export interface TrendSignals {
  qoq_change_pct: number | null;
  yoy_change_pct: number | null;
}

export interface FeeDependencyTrend {
  trend: { report_date: string; avg_fee_income_ratio: number; institution_count: number }[];
  signals: TrendSignals;
}

export interface RevenuePerInstitutionTrend {
  current: {
    by_tier: { tier: string; avg_sc_income: number; institution_count: number }[];
    by_charter: { charter: string; avg_sc_income: number; institution_count: number }[];
  };
  trend: { report_date: string; avg_sc_income: number; institution_count: number }[];
  signals: TrendSignals;
}

// ── Shared utility ───────────────────────────────────────────────────────────

export function computeTrendSignals(
  values: { date: string; value: number }[]
): TrendSignals {
  const result: TrendSignals = { qoq_change_pct: null, yoy_change_pct: null };

  if (values.length < 2) return result;

  const current = values[0].value;
  const previous = values[1].value;

  if (previous !== 0) {
    result.qoq_change_pct = Math.round(((current - previous) / previous) * 10000) / 100;
  }

  // YoY: match by quarter label, not positional offset (handles gaps)
  const currentDate = values[0].date;
  const yearAgoTarget = currentDate.replace(/^\d{4}/, (y) => String(Number(y) - 1));
  const yearAgoEntry = values.find((v) => v.date === yearAgoTarget);
  if (yearAgoEntry && yearAgoEntry.value !== 0) {
    result.yoy_change_pct = Math.round(((current - yearAgoEntry.value) / yearAgoEntry.value) * 10000) / 100;
  }

  return result;
}

// ── DERIVE-01: Revenue Concentration ─────────────────────────────────────────

const EMPTY_CONCENTRATION: RevenueConcentration = {
  dollar_volume: [],
  institution_prevalence: [],
  summary: {
    top_n: 5,
    dollar_volume_pct: 0,
    prevalence_pct: 0,
    total_fee_dollars: 0,
    total_institutions: 0,
  },
};

export async function getRevenueConcentration(
  topN = 5
): Promise<RevenueConcentration> {
  try {
    const rows = await sql`
      SELECT
        fee_category,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_fee_dollars,
        COUNT(DISTINCT institution_id) as institution_count
      FROM published_fee_catalog ef
      WHERE fee_category IS NOT NULL
        AND review_status = 'approved'
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND amount IS NOT NULL
        AND amount >= 0
      GROUP BY fee_category
      ORDER BY total_fee_dollars DESC
    `;

    const totalRow = await sql`
      SELECT COUNT(DISTINCT institution_id) as total
      FROM published_fee_catalog ef
      WHERE review_status = 'approved'
        AND ${sql.unsafe(STATS_ROW_FILTER)}
        AND amount IS NOT NULL
        AND amount >= 0
    `;

    if (rows.length === 0) {
      return { ...EMPTY_CONCENTRATION, summary: { ...EMPTY_CONCENTRATION.summary, top_n: topN } };
    }

    const totalInstitutions = Number(totalRow[0]?.total ?? 0);
    const grandTotalDollars = rows.reduce(
      (sum: number, r: Record<string, unknown>) => sum + Number(r.total_fee_dollars),
      0
    );

    // Dollar volume axis: already sorted by total_fee_dollars DESC
    const dollarEntries: ConcentrationEntry[] = rows.map(
      (r: Record<string, unknown>) => ({
        fee_category: String(r.fee_category),
        value: Number(r.total_fee_dollars),
        pct_of_total:
          grandTotalDollars > 0
            ? Math.round((Number(r.total_fee_dollars) / grandTotalDollars) * 10000) / 100
            : 0,
      })
    );

    // Prevalence axis: sort by institution_count DESC
    const prevalenceSorted = [...rows].sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b.institution_count) - Number(a.institution_count)
    );
    const prevalenceEntries: ConcentrationEntry[] = prevalenceSorted.map(
      (r: Record<string, unknown>) => ({
        fee_category: String(r.fee_category),
        value: Number(r.institution_count),
        pct_of_total:
          totalInstitutions > 0
            ? Math.round((Number(r.institution_count) / totalInstitutions) * 10000) / 100
            : 0,
      })
    );

    const topDollar = dollarEntries.slice(0, topN);
    const topPrevalence = prevalenceEntries.slice(0, topN);

    const dollarVolumePct =
      grandTotalDollars > 0
        ? Math.round(
            (topDollar.reduce((s, e) => s + e.value, 0) / grandTotalDollars) * 10000
          ) / 100
        : 0;

    // Average prevalence across top-N categories (institutions overlap, so summing > 100%)
    const prevalencePct =
      topPrevalence.length > 0
        ? Math.round(
            (topPrevalence.reduce((s, e) => s + e.pct_of_total, 0) / topPrevalence.length) * 100
          ) / 100
        : 0;

    return {
      dollar_volume: topDollar,
      institution_prevalence: topPrevalence,
      summary: {
        top_n: topN,
        dollar_volume_pct: dollarVolumePct,
        prevalence_pct: prevalencePct,
        total_fee_dollars: grandTotalDollars,
        total_institutions: totalInstitutions,
      },
    };
  } catch (e) {
    console.error("[getRevenueConcentration]", e);
    return { ...EMPTY_CONCENTRATION, summary: { ...EMPTY_CONCENTRATION.summary, top_n: topN } };
  }
}

// ── DERIVE-02: Fee Dependency Trend ──────────────────────────────────────────

const EMPTY_DEPENDENCY: FeeDependencyTrend = {
  trend: [],
  signals: { qoq_change_pct: null, yoy_change_pct: null },
};

export async function getFeeDependencyTrend(
  quarters = 4
): Promise<FeeDependencyTrend> {
  try {
    const trendRows = await sql`
      SELECT
        report_date,
        ROUND(AVG(
          CASE WHEN total_revenue > 0
               THEN service_charge_income * 1.0 / total_revenue * 100
               ELSE NULL END
        ), 2) as avg_fee_income_ratio,
        COUNT(DISTINCT institution_id) as institution_count
      FROM institution_financial_records
      WHERE service_charge_income IS NOT NULL
        AND source IN ('fdic', 'ncua')
      GROUP BY report_date
      ORDER BY report_date DESC
      LIMIT ${quarters}
    `;

    const trend = trendRows.map((r: Record<string, unknown>) => ({
      report_date: String(r.report_date),
      avg_fee_income_ratio: Number(r.avg_fee_income_ratio),
      institution_count: Number(r.institution_count),
    }));

    const signals = computeTrendSignals(
      trend.map((t) => ({ date: t.report_date, value: t.avg_fee_income_ratio }))
    );

    return { trend, signals };
  } catch (e) {
    console.error("[getFeeDependencyTrend]", e);
    return EMPTY_DEPENDENCY;
  }
}

// ── DERIVE-03: Revenue Per Institution Trend ─────────────────────────────────

const EMPTY_RPI: RevenuePerInstitutionTrend = {
  current: { by_tier: [], by_charter: [] },
  trend: [],
  signals: { qoq_change_pct: null, yoy_change_pct: null },
};

export async function getRevenuePerInstitutionTrend(
  quarters = 4
): Promise<RevenuePerInstitutionTrend> {
  try {
    // Current: by tier
    const tierRows = await sql`
      SELECT
        ct.asset_size_tier as tier,
        ROUND(AVG(ifin.service_charge_income * 1000), 0) as avg_sc_income,
        COUNT(DISTINCT ct.id) as institution_count
      FROM institution_sources ct
      JOIN institution_financial_records ifin ON ct.id = ifin.institution_id
      WHERE ifin.service_charge_income IS NOT NULL
        AND ifin.source IN ('fdic', 'ncua')
        AND ct.asset_size_tier IS NOT NULL
        AND ifin.report_date = (
          SELECT MAX(report_date) FROM institution_financial_records WHERE source IN ('fdic', 'ncua')
        )
      GROUP BY ct.asset_size_tier
      ORDER BY AVG(ifin.total_assets) ASC
    `;

    // Current: by charter
    const charterRows = await sql`
      SELECT
        ct.charter_type as charter,
        ROUND(AVG(ifin.service_charge_income * 1000), 0) as avg_sc_income,
        COUNT(DISTINCT ct.id) as institution_count
      FROM institution_sources ct
      JOIN institution_financial_records ifin ON ct.id = ifin.institution_id
      WHERE ifin.service_charge_income IS NOT NULL
        AND ifin.source IN ('fdic', 'ncua')
        AND ifin.report_date = (
          SELECT MAX(report_date) FROM institution_financial_records WHERE source IN ('fdic', 'ncua')
        )
      GROUP BY ct.charter_type
    `;

    // Trend: time series
    const trendRows = await sql`
      SELECT
        report_date,
        ROUND(AVG(service_charge_income * 1000), 0) as avg_sc_income,
        COUNT(DISTINCT institution_id) as institution_count
      FROM institution_financial_records
      WHERE service_charge_income IS NOT NULL
        AND source IN ('fdic', 'ncua')
      GROUP BY report_date
      ORDER BY report_date DESC
      LIMIT ${quarters}
    `;

    const byTier = tierRows.map((r: Record<string, unknown>) => ({
      tier: String(r.tier),
      avg_sc_income: Number(r.avg_sc_income),
      institution_count: Number(r.institution_count),
    }));

    const byCharter = charterRows.map((r: Record<string, unknown>) => ({
      charter: String(r.charter),
      avg_sc_income: Number(r.avg_sc_income),
      institution_count: Number(r.institution_count),
    }));

    const trend = trendRows.map((r: Record<string, unknown>) => ({
      report_date: String(r.report_date),
      avg_sc_income: Number(r.avg_sc_income),
      institution_count: Number(r.institution_count),
    }));

    const signals = computeTrendSignals(
      trend.map((t) => ({ date: t.report_date, value: t.avg_sc_income }))
    );

    return {
      current: { by_tier: byTier, by_charter: byCharter },
      trend,
      signals,
    };
  } catch (e) {
    console.error("[getRevenuePerInstitutionTrend]", e);
    return EMPTY_RPI;
  }
}
