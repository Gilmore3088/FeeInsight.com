/**
 * Deterministic time-series statistics for Hamilton reports. Every figure a report
 * cites about trends is computed here from stored filings and federal series, never
 * by the model.
 *
 * Methods (quarterly data):
 * - Real dollars: nominal x (base deflator / quarter deflator), using BEA's chained
 *   GDP price index (FRED GDPCTPI), expressed in the latest quarter's dollars.
 * - Seasonal adjustment: classical multiplicative decomposition (centered 2x4 moving
 *   average, mean ratio per quarter of the year, factors normalized to average 1).
 * - Trend: OLS of log real seasonally adjusted income on time, Newey-West standard errors.
 * - Stationarity: augmented Dickey-Fuller with constant and trend, lag length by AIC
 *   (up to 4), MacKinnon (2010) finite-sample critical values.
 * - Structural break: sup-F (Andrews 1993) over a break in level and trend, 15% trimming.
 */

export interface QuarterValue {
  /** "2026Q2" */
  quarter: string;
  value: number;
}

export interface DatedValue {
  date: string;
  value: number;
}

export function quarterOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${year}Q${Math.ceil(month / 3)}`;
}

function quarterIndex(quarter: string): number {
  return Number(quarter.slice(0, 4)) * 4 + Number(quarter.slice(5)) - 1;
}

function quarterFromIndex(index: number): string {
  return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
}

/** The most recent run of consecutive quarters (a gap ends the run). */
export function latestContiguousRun(series: QuarterValue[]): QuarterValue[] {
  const sorted = [...series].sort((a, b) => quarterIndex(a.quarter) - quarterIndex(b.quarter));
  let start = sorted.length - 1;
  while (start > 0 && quarterIndex(sorted[start].quarter) - quarterIndex(sorted[start - 1].quarter) === 1) start -= 1;
  return sorted.slice(Math.max(start, 0));
}

/**
 * Quarterly service-charge income in whole dollars from call-report rows (stored in
 * thousands). FDIC rows are already quarterly; NCUA rows are year-to-date, so a
 * quarter is its YTD minus the prior quarter's YTD in the same year. FFIEC rows are
 * skipped (over-scaled, and only a few quarters are held). The source with more
 * quarters wins, FDIC on a tie.
 */
export function quarterlyServiceCharges(
  records: Array<{ report_date: string; source: string; service_charge_income: number | null }>,
): { source: "fdic" | "ncua"; series: QuarterValue[] } | null {
  const bySource: Record<"fdic" | "ncua", Map<string, number>> = { fdic: new Map(), ncua: new Map() };
  for (const record of records) {
    const source = String(record.source ?? "").toLowerCase();
    if (source !== "fdic" && source !== "ncua") continue;
    const value = Number(record.service_charge_income);
    if (record.service_charge_income === null || !Number.isFinite(value)) continue;
    bySource[source].set(quarterOf(String(record.report_date).slice(0, 10)), value);
  }
  const fdic = [...bySource.fdic].map(([quarter, value]) => ({ quarter, value: value * 1_000 }));
  const ncua: QuarterValue[] = [];
  for (const [quarter, ytd] of bySource.ncua) {
    if (quarter.endsWith("Q1")) {
      ncua.push({ quarter, value: ytd * 1_000 });
      continue;
    }
    const prior = bySource.ncua.get(quarterFromIndex(quarterIndex(quarter) - 1));
    if (prior !== undefined) ncua.push({ quarter, value: (ytd - prior) * 1_000 });
  }
  const runs = { fdic: latestContiguousRun(fdic), ncua: latestContiguousRun(ncua) };
  const source = runs.fdic.length >= runs.ncua.length ? "fdic" : "ncua";
  return runs[source].length > 0 ? { source, series: runs[source] } : null;
}

/** Quarterly deflator values; monthly observations are averaged into their quarter. */
export function quarterlyDeflator(observations: DatedValue[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const obs of observations) {
    if (!Number.isFinite(obs.value) || obs.value <= 0) continue;
    const quarter = quarterOf(obs.date);
    const entry = sums.get(quarter) ?? { total: 0, count: 0 };
    entry.total += obs.value;
    entry.count += 1;
    sums.set(quarter, entry);
  }
  return new Map([...sums].map(([quarter, { total, count }]) => [quarter, total / count]));
}

/**
 * Real values in the dollars of `baseQuarter` (default: the last quarter both series
 * share). Quarters without a deflator value are dropped, never estimated.
 */
export function deflate(
  series: QuarterValue[],
  deflator: Map<string, number>,
  baseQuarter?: string,
): { base: string; series: QuarterValue[] } | null {
  const covered = series.filter((point) => deflator.has(point.quarter));
  if (covered.length === 0) return null;
  const base = baseQuarter && deflator.has(baseQuarter) ? baseQuarter : covered[covered.length - 1].quarter;
  const baseValue = deflator.get(base)!;
  return {
    base,
    series: covered.map((point) => ({ quarter: point.quarter, value: point.value * (baseValue / deflator.get(point.quarter)!) })),
  };
}

export interface SeasonalResult {
  /** Factor per quarter of the year (Q1..Q4), averaging 1. All 1 when not adjusted. */
  factors: [number, number, number, number];
  adjusted: QuarterValue[];
  applied: boolean;
}

/** Classical multiplicative seasonal adjustment; needs 3+ years of positive values. */
export function seasonallyAdjust(series: QuarterValue[]): SeasonalResult {
  const values = series.map((point) => point.value);
  if (series.length < 12 || values.some((value) => !(value > 0))) {
    return { factors: [1, 1, 1, 1], adjusted: series.map((point) => ({ ...point })), applied: false };
  }
  const ratios: number[][] = [[], [], [], []];
  for (let t = 2; t < values.length - 2; t += 1) {
    const ma = (0.5 * values[t - 2] + values[t - 1] + values[t] + values[t + 1] + 0.5 * values[t + 2]) / 4;
    ratios[Number(series[t].quarter.slice(5)) - 1].push(values[t] / ma);
  }
  const raw = ratios.map((list) => list.reduce((sum, r) => sum + r, 0) / list.length);
  const meanFactor = raw.reduce((sum, f) => sum + f, 0) / 4;
  const factors = raw.map((f) => f / meanFactor) as [number, number, number, number];
  return {
    factors,
    adjusted: series.map((point) => ({ quarter: point.quarter, value: point.value / factors[Number(point.quarter.slice(5)) - 1] })),
    applied: true,
  };
}

// ---------------------------------------------------------------------------
// Least squares
// ---------------------------------------------------------------------------

export interface OlsResult {
  beta: number[];
  /** Classical standard errors. */
  se: number[];
  residuals: number[];
  ssr: number;
  n: number;
  k: number;
}

function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    for (let j = 0; j < 2 * n; j += 1) a[col][j] /= p;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export function ols(x: number[][], y: number[]): OlsResult | null {
  const n = y.length;
  const k = x[0]?.length ?? 0;
  if (n <= k || k === 0) return null;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => x.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: k }, (_, i) => x.reduce((sum, row, t) => sum + row[i] * y[t], 0));
  const beta = inv.map((row) => row.reduce((sum, v, j) => sum + v * xty[j], 0));
  const residuals = y.map((value, t) => value - x[t].reduce((sum, v, j) => sum + v * beta[j], 0));
  const ssr = residuals.reduce((sum, e) => sum + e * e, 0);
  const sigma2 = ssr / (n - k);
  return { beta, se: inv.map((row, i) => Math.sqrt(Math.max(row[i] * sigma2, 0))), residuals, ssr, n, k };
}

/** Newey-West (Bartlett kernel) standard errors for an OLS fit. */
export function neweyWestSe(x: number[][], fit: OlsResult, lags?: number): number[] {
  const { n, k, residuals } = fit;
  const L = lags ?? Math.floor(4 * (n / 100) ** (2 / 9));
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => x.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const inv = invert(xtx);
  if (!inv) return fit.se;
  const s = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  for (let lag = 0; lag <= L; lag += 1) {
    const weight = lag === 0 ? 1 : 1 - lag / (L + 1);
    for (let t = lag; t < n; t += 1) {
      for (let i = 0; i < k; i += 1) {
        for (let j = 0; j < k; j += 1) {
          const term = residuals[t] * residuals[t - lag] * x[t][i] * x[t - lag][j];
          s[i][j] += weight * (lag === 0 ? term : term + residuals[t] * residuals[t - lag] * x[t - lag][i] * x[t][j]);
        }
      }
    }
  }
  const scale = n / (n - k);
  return inv.map((_, i) => {
    let variance = 0;
    for (let a = 0; a < k; a += 1) for (let b = 0; b < k; b += 1) variance += inv[i][a] * s[a][b] * inv[b][i];
    return Math.sqrt(Math.max(variance * scale, 0));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export interface TrendResult {
  /** Annualized trend growth, percent. */
  annual_growth_pct: number;
  /** Newey-West t statistic on the quarterly log slope. */
  t_stat: number;
  significant: boolean;
}

/** OLS trend of log values on time; growth annualized from the quarterly slope. */
export function logTrend(values: number[]): TrendResult | null {
  if (values.length < 8 || values.some((v) => !(v > 0))) return null;
  const x = values.map((_, t) => [1, t]);
  const fit = ols(x, values.map(Math.log));
  if (!fit) return null;
  const se = neweyWestSe(x, fit)[1];
  const t = se > 0 ? fit.beta[1] / se : 0;
  return { annual_growth_pct: (Math.exp(4 * fit.beta[1]) - 1) * 100, t_stat: t, significant: Math.abs(t) >= 1.96 };
}

/** MacKinnon (2010) response-surface critical values, constant and trend, one variable. */
function adfCritical(n: number, level: "1%" | "5%" | "10%"): number {
  const table = { "1%": [-3.95877, -9.0531, -28.428], "5%": [-3.41049, -4.3904, -9.036], "10%": [-3.12705, -2.5856, -3.925] }[level];
  return table[0] + table[1] / n + table[2] / (n * n);
}

export interface AdfResult {
  statistic: number;
  lags: number;
  observations: number;
  critical_5pct: number;
  critical_1pct: number;
  /** True when a unit root is rejected at 5%: the series reverts to a trend. */
  trend_stationary: boolean;
}

/** Augmented Dickey-Fuller test with constant and trend; lag length (0-maxLags) by AIC on a common sample. */
export function adfTest(values: number[], maxLags = 4): AdfResult | null {
  if (values.length < 20) return null;
  const dy = values.slice(1).map((v, i) => v - values[i]);
  const start = maxLags; // common sample so AIC compares like with like
  const design = (lags: number) => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let t = start; t < dy.length; t += 1) {
      const row = [1, t, values[t]];
      for (let i = 1; i <= lags; i += 1) row.push(dy[t - i]);
      x.push(row);
      y.push(dy[t]);
    }
    return { x, y };
  };
  let best: { lags: number; aic: number } | null = null;
  for (let lags = 0; lags <= maxLags; lags += 1) {
    const { x, y } = design(lags);
    const fit = ols(x, y);
    if (!fit || fit.ssr <= 0) continue;
    const aic = y.length * Math.log(fit.ssr / y.length) + 2 * fit.k;
    if (!best || aic < best.aic) best = { lags, aic };
  }
  if (!best) return null;
  const { x, y } = design(best.lags);
  const fit = ols(x, y);
  if (!fit || fit.se[2] <= 0) return null;
  const statistic = fit.beta[2] / fit.se[2];
  const critical5 = adfCritical(y.length, "5%");
  return {
    statistic,
    lags: best.lags,
    observations: y.length,
    critical_5pct: critical5,
    critical_1pct: adfCritical(y.length, "1%"),
    trend_stationary: statistic < critical5,
  };
}

/** Andrews (1993) sup-F critical values, 2 parameters breaking, 15% trimming. */
export const SUP_F_CRITICAL = { "10%": 10.01, "5%": 11.79, "1%": 15.73 } as const;

export interface BreakResult {
  /** First quarter of the new regime. */
  quarter: string;
  f_stat: number;
  significant: boolean;
  growth_before_pct: number;
  growth_after_pct: number;
  /** Change in level at the break, percent (from the two fitted lines). */
  level_shift_pct: number;
}

/**
 * Largest Chow F over break dates in the middle 70% of the sample, for a break in
 * both the level and the trend of log values.
 */
export function structuralBreak(series: QuarterValue[]): BreakResult | null {
  const n = series.length;
  if (n < 20 || series.some((p) => !(p.value > 0))) return null;
  const y = series.map((p) => Math.log(p.value));
  const pooled = ols(y.map((_, t) => [1, t]), y);
  if (!pooled) return null;
  const lo = Math.max(Math.ceil(0.15 * n), 4);
  const hi = Math.min(Math.floor(0.85 * n), n - 4);
  let best: { tau: number; f: number; fit: OlsResult } | null = null;
  for (let tau = lo; tau <= hi; tau += 1) {
    const x = y.map((_, t) => (t < tau ? [1, t, 0, 0] : [1, t, 1, t - tau]));
    const fit = ols(x, y);
    if (!fit || fit.ssr <= 0) continue;
    const f = ((pooled.ssr - fit.ssr) / 2) / (fit.ssr / (n - 4));
    if (!best || f > best.f) best = { tau, f, fit };
  }
  if (!best) return null;
  const [a, b, d, g] = best.fit.beta;
  const before = a + b * best.tau;
  const after = a + b * best.tau + d;
  return {
    quarter: series[best.tau].quarter,
    f_stat: best.f,
    significant: best.f > SUP_F_CRITICAL["5%"],
    growth_before_pct: (Math.exp(4 * b) - 1) * 100,
    growth_after_pct: (Math.exp(4 * (b + g)) - 1) * 100,
    level_shift_pct: (Math.exp(after - before) - 1) * 100,
  };
}

export interface AnnualPoint {
  year: number;
  nominal: number;
  real: number;
  real_yoy_pct: number | null;
}

/** Calendar years with all four quarters, nominal and real sums, real growth on the prior year. */
export function annualTotals(nominal: QuarterValue[], real: QuarterValue[]): AnnualPoint[] {
  const realByQuarter = new Map(real.map((p) => [p.quarter, p.value]));
  const years = new Map<number, { nominal: number; real: number; quarters: number }>();
  for (const point of nominal) {
    const realValue = realByQuarter.get(point.quarter);
    if (realValue === undefined) continue;
    const year = Number(point.quarter.slice(0, 4));
    const entry = years.get(year) ?? { nominal: 0, real: 0, quarters: 0 };
    entry.nominal += point.value;
    entry.real += realValue;
    entry.quarters += 1;
    years.set(year, entry);
  }
  const complete = [...years].filter(([, e]) => e.quarters === 4).sort((a, b) => a[0] - b[0]);
  return complete.map(([year, e], i) => {
    const prior = i > 0 && complete[i - 1][0] === year - 1 ? complete[i - 1][1].real : null;
    return { year, nominal: e.nominal, real: e.real, real_yoy_pct: prior ? (e.real / prior - 1) * 100 : null };
  });
}

/** Compound annual growth between the first and last complete years. */
export function cagrPct(points: AnnualPoint[], key: "nominal" | "real"): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!(first[key] > 0) || !(last[key] > 0)) return null;
  return ((last[key] / first[key]) ** (1 / (last.year - first.year)) - 1) * 100;
}
