import { ACCURACY_TARGET } from "@/lib/accuracy-target";

/** Reporting protocol, separate from the checks' versions: changes never splice a trend. */
export const ACCURACY_REPORTING_VERSION = 1;
export const ACCURACY_DAILY_SAMPLE = 500;
/** At p=.995, n=3,400 gives a two-sided 95% Wilson interval with half-width <.0025. */
export const ACCURACY_WEEKLY_MIN_SCORABLE = 3_400;
export const ACCURACY_MIN_SCORABLE = 30;
export const ACCURACY_HISTORY_WEEKS = 12;

export type AuditVerdict = "right" | "unknown" | "amount" | "category" | "evidence" | "notAFee" | "name";
/** Compact, durable per-fee receipt: published fee id, verdict. Unknowns stay in the denominator report. */
export type AuditObservation = [number, AuditVerdict];
export interface AccuracyMisses { amount: number; category: number; evidence: number; notAFee: number; name: number }
export interface AccuracyDay extends AccuracyMisses {
  at: string;
  right: number;
  scorable: number;
  accuracy: number | null;
  seed?: string;
  series?: string | null;
  observations?: AuditObservation[];
}
export interface AccuracyEvent { at: string; detail: Record<string, unknown> | null }
export type AccuracyStatus = "met" | "not_met" | "insufficient" | "legacy";
export interface AccuracyMeasure {
  accuracy: number | null;
  right: number;
  scorable: number;
  audits: number;
  latestAt: string | null;
  latestAccuracy: number | null;
  range: { low: number; high: number } | null;
  daily: AccuracyDay[];
  misses: AccuracyMisses;
  series?: string | null;
  sampled?: number;
  unknown?: number;
  repeatedFees?: number;
  duplicateDraws?: number;
  excludedAudits?: number;
  status?: AccuracyStatus;
  requiredScorable?: number;
}

const MISS_KEYS = ["amount", "category", "evidence", "notAFee", "name"] as const;
const VERDICTS = new Set<string>(["right", "unknown", ...MISS_KEYS]);
const emptyMisses = (): AccuracyMisses => ({ amount: 0, category: 0, evidence: 0, notAFee: 0, name: 0 });
const ratio = (a: number, b: number) => b > 0 ? a / b : null;
const validCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Keep full precision for the gate; display rounding must never turn a near miss into a pass. */
export function wilsonRange(right: number, n: number): { low: number; high: number } | null {
  if (!validCount(right) || !validCount(n) || n <= 0 || right > n) return null;
  const z2 = 1.96 ** 2;
  const p = right / n;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = Math.sqrt(z2 * (p * (1 - p) / n + z2 / (4 * n * n)));
  return { low: Math.max(0, (centre - margin) / denominator), high: Math.min(1, (centre + margin) / denominator) };
}

/** Missing version metadata is historical evidence, never inferred to mean today's checks. */
export function accuracySeries(detail: Record<string, unknown>): string | null {
  const versions = [detail.reporting_version, detail.version, detail.category_guard_version, detail.source_check_version, detail.name_check_version];
  return versions.every((v) => validCount(v) && v > 0) ? versions.join(".") : null;
}

export function accuracyStatus(measure: Pick<AccuracyMeasure, "series" | "scorable" | "range">): AccuracyStatus {
  if (!measure.series) return "legacy";
  if (measure.scorable < ACCURACY_WEEKLY_MIN_SCORABLE || !measure.range) return "insufficient";
  return measure.range.low >= ACCURACY_TARGET ? "met" : "not_met";
}

export function accuracyStatusLabel(measure: Pick<AccuracyMeasure, "series" | "scorable" | "range">): string {
  switch (accuracyStatus(measure)) {
    case "legacy": return "legacy — scoring versions or per-fee receipts unavailable";
    case "insufficient": return `insufficient sample (${measure.scorable.toLocaleString("en-US")} of ${ACCURACY_WEEKLY_MIN_SCORABLE.toLocaleString("en-US")} unique scorable fees)`;
    case "met": return "met on the 95% lower bound";
    case "not_met": return "not met on the 95% lower bound";
  }
}

/** Outward rounding cannot display a lower bound above the value the gate actually used. */
export function formatAccuracyBound(value: number, side: "low" | "high"): string {
  const round = side === "low" ? Math.floor : Math.ceil;
  return `${(round(value * 10_000) / 100).toFixed(2)}%`;
}

function observationsFrom(value: unknown): AuditObservation[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const out: AuditObservation[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || !validCount(item[0]) || item[0] <= 0 || !VERDICTS.has(item[1]) || seen.has(item[0])) return null;
    seen.add(item[0]);
    out.push([item[0], item[1] as AuditVerdict]);
  }
  return out;
}

function summarize(observations: AuditObservation[]) {
  const misses = emptyMisses();
  let right = 0;
  let unknown = 0;
  for (const [, verdict] of observations) {
    if (verdict === "right") right += 1;
    else if (verdict === "unknown") unknown += 1;
    else misses[verdict] += 1;
  }
  return { right, unknown, scorable: observations.length - unknown, misses };
}

/** Validate a receipt before it can contribute to a confidence interval. */
function readDay(event: AccuracyEvent): AccuracyDay | null {
  const detail = event.detail;
  if (!detail || detail.readable === false || !Number.isFinite(Date.parse(event.at))) return null;
  if (!validCount(detail.right) || !validCount(detail.scorable) || detail.right > detail.scorable) return null;
  const series = accuracySeries(detail);
  const observations = observationsFrom(detail.observations);
  const counts = observations ? summarize(observations) : null;
  const eligible = series !== null && observations !== null && typeof detail.seed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(detail.seed) && counts?.right === detail.right && counts?.scorable === detail.scorable && detail.sampled === observations.length && detail.no_text === counts?.unknown;
  const misses = emptyMisses();
  const fields = ["amount_miss", "category_miss", "evidence_miss", "not_a_fee", "name_miss"];
  MISS_KEYS.forEach((key, i) => { misses[key] = validCount(detail[fields[i]]) ? detail[fields[i]] as number : 0; });
  return {
    at: event.at, right: detail.right, scorable: detail.scorable, accuracy: ratio(detail.right, detail.scorable),
    ...misses, seed: typeof detail.seed === "string" ? detail.seed : event.at.slice(0, 10),
    series: eligible ? series : null,
    ...(eligible ? { observations } : {}),
  };
}

/** Latest successful receipt for a seeded daily draw; retries do not add a second sample. */
export function accuracyDays(events: AccuracyEvent[]): { days: AccuracyDay[]; duplicateDraws: number } {
  const draws = new Map<string, AccuracyDay>();
  let duplicateDraws = 0;
  for (const day of events.map(readDay).filter((v): v is AccuracyDay => v !== null).sort((a, b) => b.at.localeCompare(a.at))) {
    const key = `${day.seed}|${day.series ?? "legacy"}`;
    if (draws.has(key)) { duplicateDraws += 1; continue; }
    draws.set(key, day);
  }
  return { days: [...draws.values()], duplicateDraws };
}

/** Pool one checker series only, and count each published fee once (its newest verdict wins). */
export function poolAccuracyDays(days: AccuracyDay[], duplicateDraws = 0): AccuracyMeasure {
  const ordered = [...days].sort((a, b) => b.at.localeCompare(a.at));
  const latest = ordered[0];
  const series = latest?.series ?? null;
  const selected = ordered.filter((day) => (day.series ?? null) === series);
  const unique = new Map<number, AuditVerdict>();
  let repeatedFees = 0;
  for (const day of selected) for (const [id, verdict] of day.observations ?? []) {
    if (unique.has(id)) repeatedFees += 1;
    else unique.set(id, verdict);
  }
  const counts = summarize([...unique]);
  // Legacy aggregate counts can be displayed, but have no independent-unit receipts or valid interval.
  const right = series ? counts.right : selected.reduce((n, day) => n + day.right, 0);
  const scorable = series ? counts.scorable : selected.reduce((n, day) => n + day.scorable, 0);
  const misses = series ? counts.misses : emptyMisses();
  if (!series) for (const day of selected) for (const key of MISS_KEYS) misses[key] += day[key];
  const enough = scorable >= ACCURACY_MIN_SCORABLE;
  const result: AccuracyMeasure = {
    accuracy: enough ? ratio(right, scorable) : null, right, scorable, audits: selected.length,
    latestAt: latest?.at ?? null, latestAccuracy: latest?.accuracy ?? null,
    range: series && enough ? wilsonRange(right, scorable) : null,
    daily: ordered, misses, series, sampled: series ? unique.size : undefined,
    unknown: series ? counts.unknown : undefined, repeatedFees, duplicateDraws,
    excludedAudits: ordered.length - selected.length, requiredScorable: ACCURACY_WEEKLY_MIN_SCORABLE,
  };
  result.status = accuracyStatus(result);
  return result;
}

export function poolFreshAudits(events: AccuracyEvent[]): AccuracyMeasure {
  const { days, duplicateDraws } = accuracyDays(events);
  return poolAccuracyDays(days, duplicateDraws);
}

/** Reconstruct an event from the daily receipt kept in a scoreboard snapshot. */
export function eventFromAccuracyDay(day: AccuracyDay): AccuracyEvent {
  const versions = day.series?.split(".").map(Number) ?? [];
  const observations = observationsFrom(day.observations) ?? undefined;
  return { at: day.at, detail: {
    right: day.right, scorable: day.scorable, seed: day.seed,
    reporting_version: versions[0], version: versions[1], category_guard_version: versions[2], source_check_version: versions[3], name_check_version: versions[4],
    observations, sampled: observations?.length,
    no_text: observations?.filter(([, v]) => v === "unknown").length,
    amount_miss: day.amount, category_miss: day.category, evidence_miss: day.evidence, not_a_fee: day.notAFee, name_miss: day.name,
  } };
}
