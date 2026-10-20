/**
 * Cleaning pass for loaded regulator values. Pure: it reports gaps and outliers into a run's
 * detail and never changes, drops or fills a value. A flagged value is still stored as filed.
 */

export interface ValueCheckInput {
  key: string;
  id: string;
  value: number;
}

export interface KeyValueReport {
  key: string;
  values: number;
  negatives: number;
  /** Values above OUTLIER_MULTIPLE times the key's 99th percentile. */
  outliers: number;
  /** Up to five flagged ids with their values, for a person to look at. */
  examples: Array<{ id: string; value: number; reason: "negative" | "outlier" }>;
}

export const OUTLIER_MULTIPLE = 20;
const MIN_VALUES_FOR_OUTLIERS = 50;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[at];
}

/**
 * Per key: how many values are negative where `canBeNegative` says they can't be, and how many
 * sit far above the rest. Keys with fewer than 50 values get no outlier test.
 */
export function checkValues(rows: ValueCheckInput[], canBeNegative: (key: string) => boolean = () => false): KeyValueReport[] {
  const byKey = new Map<string, ValueCheckInput[]>();
  for (const row of rows) {
    const list = byKey.get(row.key);
    if (list) list.push(row);
    else byKey.set(row.key, [row]);
  }
  const out: KeyValueReport[] = [];
  for (const [key, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = list.map((r) => r.value).sort((a, b) => a - b);
    const p99 = percentile(sorted, 0.99);
    const limit = list.length >= MIN_VALUES_FOR_OUTLIERS && p99 > 0 ? p99 * OUTLIER_MULTIPLE : Infinity;
    const report: KeyValueReport = { key, values: list.length, negatives: 0, outliers: 0, examples: [] };
    for (const row of list) {
      const reason = row.value < 0 && !canBeNegative(key) ? "negative" : row.value > limit ? "outlier" : null;
      if (!reason) continue;
      if (reason === "negative") report.negatives += 1;
      else report.outliers += 1;
      if (report.examples.length < 5) report.examples.push({ id: row.id, value: row.value, reason });
    }
    out.push(report);
  }
  return out;
}

/** Only the keys with something to look at, so a run detail stays short. */
export function flaggedOnly(reports: KeyValueReport[]): KeyValueReport[] {
  return reports.filter((r) => r.negatives > 0 || r.outliers > 0);
}
