/**
 * The statistics the studies use. Pure and dependency-free so every number a study
 * stores can be recomputed from its inputs in a test.
 */

export function quantile(values: number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : null;
}

/** Mid-rank percentile (0-100): share of peers below the value plus half of those equal. */
export function midRankPercentile(value: number, peers: number[]): number | null {
  if (!Number.isFinite(value) || peers.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const p of peers) {
    if (p < value) below++;
    else if (p === value) equal++;
  }
  return Math.round(((below + equal / 2) / peers.length) * 1000) / 10;
}

export function quartileOf(percentile: number | null): number | null {
  if (percentile === null) return null;
  if (percentile < 25) return 1;
  if (percentile < 50) return 2;
  if (percentile < 75) return 3;
  return 4;
}

/** Average ranks (1-based), ties share their mean rank. */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function spearman(x: number[], y: number[]): number | null {
  return pearson(ranks(x), ranks(y));
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let c = 0; c < 2 * n; c++) a[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row.slice(n));
}

export interface Coefficient {
  name: string;
  estimate: number;
  /** Heteroskedasticity-robust (HC1) standard error. */
  se: number;
  ciLow: number;
  ciHigh: number;
  /** Two-sided, normal approximation. */
  p: number;
}

export interface OlsResult {
  n: number;
  r2: number;
  coefficients: Coefficient[];
}

/**
 * Ordinary least squares with an intercept and HC1 robust standard errors. `columns`
 * maps each regressor name to its values. Returns null when the design is singular or
 * there are too few rows for the number of regressors.
 */
export function ols(y: number[], columns: Record<string, number[]>): OlsResult | null {
  const names = ["intercept", ...Object.keys(columns)];
  const n = y.length;
  const k = names.length;
  if (n <= k + 2) return null;
  const X = y.map((_, i) => [1, ...Object.values(columns).map((col) => col[i])]);
  const xtx = names.map((_, a) => names.map((__, b) => X.reduce((s, row) => s + row[a] * row[b], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = names.map((_, a) => X.reduce((s, row, i) => s + row[a] * y[i], 0));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const resid = X.map((row, i) => y[i] - row.reduce((s, v, j) => s + v * beta[j], 0));
  const meat = names.map((_, a) => names.map((__, b) => X.reduce((s, row, i) => s + row[a] * row[b] * resid[i] ** 2, 0)));
  const scale = n / (n - k);
  const cov = names.map(() => names.map(() => 0));
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let s = 0;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) s += inv[a][i] * meat[i][j] * inv[j][b];
      cov[a][b] = s * scale;
    }
  }
  const my = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  return {
    n,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    coefficients: names.map((name, i) => {
      const se = Math.sqrt(Math.max(cov[i][i], 0));
      const z = se > 0 ? beta[i] / se : 0;
      return {
        name,
        estimate: beta[i],
        se,
        ciLow: beta[i] - 1.96 * se,
        ciHigh: beta[i] + 1.96 * se,
        p: se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1,
      };
    }),
  };
}

export function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
