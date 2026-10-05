/**
 * The fee-income trend exhibit and the statistical appendix for a Hamilton report.
 * Every number comes from the institution's call reports and federal series through
 * the deterministic methods in ./econometrics; the model only narrates them.
 */
import { getIndicatorTimeSeries, getServiceChargeHistory } from "@/lib/data-store/financial";
import { formatCompactDollars } from "@/lib/format";
import {
  adfTest,
  annualTotals,
  cagrPct,
  deflate,
  logTrend,
  quarterlyDeflator,
  quarterlyServiceCharges,
  seasonallyAdjust,
  structuralBreak,
  type DatedValue,
  type QuarterValue,
} from "./econometrics";
import type { ReportExhibit, ReportSource } from "./types";

/** Fewer quarters than this and the tests are not meaningful. */
export const MIN_TREND_QUARTERS = 20;
const TABLE_YEARS = 8;

export interface FeeIncomeTrendData {
  income_label: string;
  source: "fdic" | "ncua";
  first_quarter: string;
  last_quarter: string;
  quarters: number;
  /** Real figures are in this quarter's dollars (chained GDP price index). */
  dollars_of: string;
  real_cagr_pct: number | null;
  nominal_cagr_pct: number | null;
  cagr_years: { from: number; to: number } | null;
  industry_real_cagr_pct: number | null;
  trend: { annual_growth_pct: number; t_stat: number; significant: boolean } | null;
  stationarity: { adf_statistic: number; critical_5pct: number; lags: number; trend_stationary: boolean } | null;
  structural_break: {
    quarter: string;
    f_stat: number;
    critical_5pct: number;
    significant: boolean;
    level_shift_pct: number;
    growth_before_pct: number;
    growth_after_pct: number;
  } | null;
  seasonal_factors: { q1: number; q2: number; q3: number; q4: number } | null;
  years: Array<{ year: number; nominal: number; real: number; real_change_pct: number | null; industry_real_change_pct: number | null }>;
}

export interface FeeIncomeTrendResult {
  data: FeeIncomeTrendData;
  exhibits: ReportExhibit[];
  sources: ReportSource[];
}

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

function pct(value: number | null): string {
  if (value === null) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Industry deposit service charges (FDIC Quarterly Banking Profile via FRED), millions of dollars. */
function industryQuarters(observations: DatedValue[]): QuarterValue[] {
  return Array.from(quarterlyDeflator(observations.map((o) => ({ date: o.date, value: o.value * 1_000_000 }))))
    .map(([quarter, value]) => ({ quarter, value }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
}

export function buildFeeIncomeTrend(params: {
  institutionName: string;
  records: Array<{ report_date: string; source: string; service_charge_income: number | null }>;
  /** FRED GDPCTPI observations. */
  gdpPriceIndex: DatedValue[];
  /** FRED QBPQYTNIYSRVDP observations (all FDIC-insured institutions, millions). */
  industryServiceCharges: DatedValue[];
}): FeeIncomeTrendResult | null {
  const nominal = quarterlyServiceCharges(params.records);
  if (!nominal || nominal.series.length < MIN_TREND_QUARTERS) return null;
  const deflator = quarterlyDeflator(params.gdpPriceIndex);
  const real = deflate(nominal.series, deflator);
  if (!real || real.series.length < MIN_TREND_QUARTERS) return null;

  const covered = new Set(real.series.map((p) => p.quarter));
  const nominalCovered = nominal.series.filter((p) => covered.has(p.quarter));
  const seasonal = seasonallyAdjust(real.series);
  const adjustedValues = seasonal.adjusted.map((p) => p.value);
  const trend = logTrend(adjustedValues);
  const adf = adjustedValues.every((v) => v > 0) ? adfTest(adjustedValues.map(Math.log)) : null;
  const brk = structuralBreak(seasonal.adjusted);
  const years = annualTotals(nominalCovered, real.series);

  const industryNominal = industryQuarters(params.industryServiceCharges);
  const industryReal = deflate(industryNominal, deflator, real.base);
  const industryYears = industryReal ? annualTotals(industryNominal, industryReal.series) : [];
  const industryByYear = new Map(industryYears.map((y) => [y.year, y]));
  const span = years.length >= 2 ? { from: years[0].year, to: years[years.length - 1].year } : null;
  const industrySpan = span
    ? industryYears.filter((y) => y.year === span.from || y.year === span.to)
    : [];

  const incomeLabel = nominal.source === "ncua" ? "fee income" : "deposit service charges";
  const data: FeeIncomeTrendData = {
    income_label: incomeLabel,
    source: nominal.source,
    first_quarter: real.series[0].quarter,
    last_quarter: real.series[real.series.length - 1].quarter,
    quarters: real.series.length,
    dollars_of: real.base,
    real_cagr_pct: nullableRound(cagrPct(years, "real")),
    nominal_cagr_pct: nullableRound(cagrPct(years, "nominal")),
    cagr_years: span,
    industry_real_cagr_pct: industrySpan.length === 2 ? nullableRound(cagrPct(industrySpan, "real")) : null,
    trend: trend ? { annual_growth_pct: round(trend.annual_growth_pct), t_stat: round(trend.t_stat, 2), significant: trend.significant } : null,
    stationarity: adf
      ? { adf_statistic: round(adf.statistic, 2), critical_5pct: round(adf.critical_5pct, 2), lags: adf.lags, trend_stationary: adf.trend_stationary }
      : null,
    structural_break: brk
      ? {
          quarter: brk.quarter,
          f_stat: round(brk.f_stat, 1),
          critical_5pct: 11.79,
          significant: brk.significant,
          level_shift_pct: round(brk.level_shift_pct),
          growth_before_pct: round(brk.growth_before_pct),
          growth_after_pct: round(brk.growth_after_pct),
        }
      : null,
    seasonal_factors: seasonal.applied
      ? { q1: round(seasonal.factors[0], 3), q2: round(seasonal.factors[1], 3), q3: round(seasonal.factors[2], 3), q4: round(seasonal.factors[3], 3) }
      : null,
    years: years.slice(-TABLE_YEARS).map((y) => ({
      year: y.year,
      nominal: Math.round(y.nominal),
      real: Math.round(y.real),
      real_change_pct: nullableRound(y.real_yoy_pct),
      industry_real_change_pct: nullableRound(industryByYear.get(y.year)?.real_yoy_pct ?? null),
    })),
  };

  const name = params.institutionName;
  const direction = (value: number | null) => (value === null ? "changed" : value >= 0 ? "grew" : "fell");
  const title =
    data.real_cagr_pct !== null && span
      ? `After inflation, ${name}'s ${incomeLabel} ${direction(data.real_cagr_pct)} ${Math.abs(data.real_cagr_pct).toFixed(1)}% a year from ${span.from} to ${span.to}` +
        (data.industry_real_cagr_pct !== null
          ? `; the industry ${direction(data.industry_real_cagr_pct)} ${Math.abs(data.industry_real_cagr_pct).toFixed(1)}%`
          : "")
      : `${name}'s ${incomeLabel}, ${data.first_quarter} to ${data.last_quarter}`;
  const breakNote =
    data.structural_break?.significant
      ? ` The series shifted in ${data.structural_break.quarter}: the level moved ${pct(data.structural_break.level_shift_pct)} and trend growth went from ${pct(data.structural_break.growth_before_pct)} to ${pct(data.structural_break.growth_after_pct)} a year.`
      : "";

  const exhibits: ReportExhibit[] = [
    {
      id: "fee_income_trend",
      title,
      subtitle: `Full calendar years from the ${nominal.source === "ncua" ? "NCUA 5300" : "FDIC call"} report. Real figures are in ${real.base} dollars, deflated by BEA's chained GDP price index. The industry is all FDIC-insured institutions.${breakNote}`,
      columns: ["Year", "Reported", `Real (${real.base} $)`, "Real change", "Industry real change"],
      rows: data.years.map((y) => [
        String(y.year),
        formatCompactDollars(y.nominal),
        formatCompactDollars(y.real),
        pct(y.real_change_pct),
        pct(y.industry_real_change_pct),
      ]),
      note:
        nominal.source === "ncua"
          ? "Credit unions report total fee income year to date; each quarter is the year-to-date figure less the prior quarter's. The industry line covers banks, not credit unions."
          : null,
    },
    {
      id: "statistical_appendix",
      title: `Statistical appendix: ${data.quarters} quarters, ${data.first_quarter} to ${data.last_quarter}`,
      subtitle:
        "Tests run on real, seasonally adjusted quarterly income (log scale). Seasonal factors come from a classical multiplicative decomposition.",
      columns: ["Measure", "Result", "Statistic", "5% critical value", "Reading"],
      rows: appendixRows(data),
      note:
        "Method: trend by least squares with Newey-West standard errors. Stationarity by augmented Dickey-Fuller with constant and trend, lags chosen by AIC, MacKinnon (2010) critical values. Break by sup-F over a shift in level and trend, 15% trimming, Andrews (1993) critical values. Serial correlation can overstate break significance, so read a break alongside known events.",
    },
  ];

  const sources: ReportSource[] = [
    {
      label: `${name} ${incomeLabel}, ${data.first_quarter} to ${data.last_quarter}`,
      detail: nominal.source === "ncua" ? "NCUA 5300 call reports, quarterly." : "FDIC call reports, quarterly.",
      url: null,
    },
    { label: "GDP chain-type price index (GDPCTPI)", detail: "U.S. Bureau of Economic Analysis via FRED.", url: "https://fred.stlouisfed.org/series/GDPCTPI" },
  ];
  if (industryYears.length > 0) {
    sources.push({
      label: "Industry service charges on deposit accounts (QBPQYTNIYSRVDP)",
      detail: "FDIC Quarterly Banking Profile via FRED.",
      url: "https://fred.stlouisfed.org/series/QBPQYTNIYSRVDP",
    });
  }
  return { data, exhibits, sources };
}

function nullableRound(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : round(value);
}

function appendixRows(data: FeeIncomeTrendData): string[][] {
  const rows: string[][] = [];
  if (data.trend) {
    rows.push([
      "Trend growth, real",
      `${pct(data.trend.annual_growth_pct)} a year`,
      `t = ${data.trend.t_stat.toFixed(2)}`,
      "|t| > 1.96",
      data.trend.significant ? "A real trend" : "No clear trend",
    ]);
  }
  if (data.stationarity) {
    rows.push([
      "Stationarity (ADF)",
      data.stationarity.trend_stationary ? "Reverts to trend" : "Unit root not rejected",
      data.stationarity.adf_statistic.toFixed(2),
      data.stationarity.critical_5pct.toFixed(2),
      data.stationarity.trend_stationary
        ? "Shocks fade; the trend is a fair guide"
        : "Shocks persist; treat the trend with care",
    ]);
  }
  if (data.structural_break) {
    rows.push([
      "Structural break",
      data.structural_break.significant ? `Break in ${data.structural_break.quarter}` : "None at 5%",
      `F = ${data.structural_break.f_stat.toFixed(1)}`,
      data.structural_break.critical_5pct.toFixed(2),
      data.structural_break.significant
        ? `Level ${pct(data.structural_break.level_shift_pct)}; trend ${pct(data.structural_break.growth_before_pct)} to ${pct(data.structural_break.growth_after_pct)} a year`
        : `Largest candidate ${data.structural_break.quarter}`,
    ]);
  }
  if (data.seasonal_factors) {
    const f = data.seasonal_factors;
    rows.push(["Seasonal factors", "Q1 to Q4", `${f.q1.toFixed(3)} / ${f.q2.toFixed(3)} / ${f.q3.toFixed(3)} / ${f.q4.toFixed(3)}`, "", "1.000 = an average quarter"]);
  }
  return rows;
}

/** FRED observations come back from Postgres as Date or text. */
function toDatedValue(o: { observation_date: unknown; value: unknown }): DatedValue {
  const date = o.observation_date instanceof Date ? o.observation_date.toISOString() : String(o.observation_date);
  return { date: date.slice(0, 10), value: Number(o.value) };
}

/**
 * Loads an institution's call-report history and the federal series, then builds the
 * trend. Null when there are too few quarters. Shared by Hamilton reports and the
 * per-bank peer brief so both cite the same numbers.
 */
export async function getFeeIncomeTrend(institutionId: number, institutionName: string): Promise<FeeIncomeTrendResult | null> {
  const [records, gdp, industry] = await Promise.all([
    getServiceChargeHistory(institutionId),
    getIndicatorTimeSeries("GDPCTPI", { fromDate: "2009-01-01" }),
    getIndicatorTimeSeries("QBPQYTNIYSRVDP", { fromDate: "2009-01-01" }),
  ]);
  return buildFeeIncomeTrend({
    institutionName,
    records,
    gdpPriceIndex: gdp.map(toDatedValue),
    industryServiceCharges: industry.map(toDatedValue),
  });
}
