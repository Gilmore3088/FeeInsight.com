/**
 * Buckets for a fee distribution chart: one point per institution (its counted value),
 * clean dollar steps across the middle 90%, and open-ended end buckets only when
 * something actually sits beyond them, so the axis never runs past the data.
 */
export interface HistogramPoint {
  value: number;
  isBank: boolean;
}

export interface HistogramBucket {
  label: string;
  /** Inclusive lower bound; null when the bucket is open below. */
  min: number | null;
  /** Inclusive upper bound in cents precision; null when the bucket is open above. */
  max: number | null;
  banks: number;
  creditUnions: number;
  total: number;
}

const TARGET_BUCKETS = 12;

function dollars(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function cleanStep(span: number): number {
  const raw = span / TARGET_BUCKETS;
  if (raw <= 1) return 1;
  if (raw <= 2) return 2;
  if (raw <= 5) return 5;
  if (raw <= 10) return 10;
  return Math.ceil(raw / 5) * 5;
}

export function buildHistogramBuckets(points: HistogramPoint[]): HistogramBucket[] {
  if (points.length === 0) return [];
  const sorted = points.map((p) => p.value).sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];
  const step = cleanStep(p95 - p5);
  const lo = Math.floor(p5 / step) * step;
  const hi = (Math.floor(p95 / step) + 1) * step;

  const buckets: HistogramBucket[] = [];
  const hasUnder = sorted[0] < lo;
  const hasOver = sorted[sorted.length - 1] >= hi;
  if (hasUnder) {
    buckets.push({ label: `Under ${dollars(lo)}`, min: null, max: lo - 0.01, banks: 0, creditUnions: 0, total: 0 });
  }
  for (let start = lo; start < hi; start += step) {
    buckets.push({
      label: step === 1 ? dollars(start) : `${dollars(start)}–${dollars(start + step - 0.01)}`,
      min: start,
      max: start + step - 0.01,
      banks: 0,
      creditUnions: 0,
      total: 0,
    });
  }
  if (hasOver) {
    buckets.push({ label: `${dollars(hi)}+`, min: hi, max: null, banks: 0, creditUnions: 0, total: 0 });
  }

  for (const point of points) {
    const bucket = buckets.find(
      (b) => (b.min === null || point.value >= b.min) && (b.max === null || point.value < b.max + 0.01),
    );
    if (!bucket) continue;
    if (point.isBank) bucket.banks++;
    else bucket.creditUnions++;
    bucket.total++;
  }
  return buckets;
}

/** The bucket a value falls in, for placing the median marker. */
export function bucketFor(buckets: HistogramBucket[], value: number): HistogramBucket | undefined {
  return buckets.find((b) => (b.min === null || value >= b.min) && (b.max === null || value < b.max + 0.01));
}
