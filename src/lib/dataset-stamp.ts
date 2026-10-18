/**
 * Which data a statistic was computed from (#1924, launch item D8). Every median, percentile
 * and count Hamilton shows or exports carries one: its dataset, whether it was read live or
 * from a snapshot and when, the run that built the snapshot, the statistics method version,
 * the counting rule and the filters that set its population. Two figures that differ (the
 * 2,495 / 2,503 / 2,505 overdraft counts) can then be traced to their difference with
 * `stampDifferences`.
 *
 * Pure and client-safe: no database imports. Stamps are built by the index readers
 * (data-store/fee-index.ts catalogStamp); labels here are data for later screens to render.
 */

/** The tables and views a statistic can be read from. */
export type DatasetId = "published_fee_catalog" | "published_fee_rate_catalog" | "fee_index_cache";

/** Live: computed from the dataset when the query returned. Cached: read from a stored snapshot. */
export type StampMode = "live" | "cached";

/**
 * How institutions are counted: sibling charters sharing one fee schedule count once
 * (fee-stats.ts rule 7, COUNT_SHARED_SCHEDULE_ONCE), or every charter counts on its own.
 */
export type CountingRule = "counted_once" | "per_charter";

/** One condition that sets the population, with stable key and plain-language label. */
export interface PopulationFilter {
  /** Stable machine key; two stamps share a filter when their keys match. */
  key: string;
  /** Plain words for the filter. */
  label: string;
}

export interface DatasetStamp {
  dataset: DatasetId;
  /** For a snapshot, the dataset it was computed from. */
  derivedFrom?: DatasetId;
  mode: StampMode;
  /** ISO time: when the live query returned, or when the snapshot was computed. */
  readAt: string;
  /**
   * The agent run that built the snapshot; null for a live read or when unknown. For
   * fee_index_cache, the run of the newest cache row only (#2007).
   */
  runId: number | null;
  /** ISO time of the newest record behind the figures, when known. Context only: not part of `id`. */
  newestRecordAt: string | null;
  /** STATS_METHOD_VERSION the figures were computed under. */
  methodVersion: number;
  counting: CountingRule;
  filters: PopulationFilter[];
  /** Stable id over everything above except newestRecordAt. */
  id: string;
}

export type DatasetStampInput = Omit<DatasetStamp, "id">;

const DATASET_LABELS: Record<DatasetId, string> = {
  published_fee_catalog: "Published dollar fees",
  published_fee_rate_catalog: "Published rate fees",
  fee_index_cache: "Bank Fee Index national snapshot",
};

const COUNTING_LABELS: Record<CountingRule, string> = {
  counted_once: "Institutions that share one fee schedule count as one institution",
  per_charter: "Every charter counts as its own institution",
};

/** An ISO time from a Date, an ISO or Postgres timestamp string, or epoch milliseconds; null when unreadable. */
export function toIsoTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? date.toISOString() : null;
}

/** A run id from a number, a bigint or a numeric string (postgres.js returns bigints as strings); null otherwise. */
export function toRunId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "bigint" ? Number(value) : Number(String(value).trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** cyrb53: a small, stable, non-cryptographic string hash. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Stable id for a stamp: the same dataset, read, run, method, counting rule and filter keys
 * always give the same id, whatever order the filters arrive in. newestRecordAt and labels
 * are left out (context and wording, not identity).
 */
export function stampId(stamp: DatasetStampInput | DatasetStamp): string {
  const identity = JSON.stringify([
    stamp.dataset,
    stamp.derivedFrom ?? null,
    stamp.mode,
    toIsoTime(stamp.readAt) ?? stamp.readAt,
    stamp.runId,
    stamp.methodVersion,
    stamp.counting,
    [...new Set(stamp.filters.map((f) => f.key))].sort(),
  ]);
  return `ds_${hash53(identity)}`;
}

/** A stamp with normalised times and run id, duplicate filter keys dropped, and its id. */
export function makeStamp(input: DatasetStampInput): DatasetStamp {
  const seen = new Set<string>();
  const filters = input.filters.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
  const base: DatasetStampInput = {
    dataset: input.dataset,
    ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
    mode: input.mode,
    readAt: toIsoTime(input.readAt) ?? String(input.readAt),
    runId: toRunId(input.runId),
    newestRecordAt: toIsoTime(input.newestRecordAt),
    methodVersion: Number(input.methodVersion),
    counting: input.counting,
    filters,
  };
  return { ...base, id: stampId(base) };
}

/** "2026-10-18 14:05 UTC": fixed format, the same on server and client. */
export function formatStampTime(iso: string | null): string {
  const at = toIsoTime(iso);
  if (!at) return "an unknown time";
  return `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;
}

export function datasetLabel(dataset: DatasetId): string {
  return DATASET_LABELS[dataset];
}

export function countingLabel(counting: CountingRule): string {
  return COUNTING_LABELS[counting];
}

function readWords(stamp: Pick<DatasetStamp, "mode" | "readAt">): string {
  return stamp.mode === "cached"
    ? `snapshot computed ${formatStampTime(stamp.readAt)}`
    : `read live ${formatStampTime(stamp.readAt)}`;
}

/** One line for a chip, and the full list for a details panel. */
export function formatStamp(stamp: DatasetStamp): { short: string; detail: string[] } {
  const short = `${datasetLabel(stamp.dataset)}, ${readWords(stamp)}`;
  const detail = [
    `Dataset: ${datasetLabel(stamp.dataset)}`,
    ...(stamp.derivedFrom ? [`Computed from: ${datasetLabel(stamp.derivedFrom)}`] : []),
    stamp.mode === "cached"
      ? `Snapshot computed: ${formatStampTime(stamp.readAt)}`
      : `Read live: ${formatStampTime(stamp.readAt)}`,
    ...(stamp.runId !== null ? [`Built by run ${stamp.runId}`] : []),
    ...(stamp.newestRecordAt ? [`Newest fee record: ${formatStampTime(stamp.newestRecordAt)}`] : []),
    `Statistics method version ${stamp.methodVersion}`,
    `Counting: ${countingLabel(stamp.counting)}`,
    ...stamp.filters.map((f) => `Filter: ${f.label}`),
    `Stamp ${stamp.id}`,
  ];
  return { short, detail };
}

/**
 * Why two figures can differ, as plain lines: dataset, live or snapshot and when, the run,
 * the method version, the counting rule, and every filter one has that the other lacks
 * ("added" is in `b` only, "removed" in `a` only). Empty when the stamps describe the same read.
 */
export function stampDifferences(a: DatasetStamp, b: DatasetStamp): string[] {
  const out: string[] = [];
  if (a.dataset !== b.dataset) out.push(`Dataset: ${datasetLabel(a.dataset)} vs ${datasetLabel(b.dataset)}`);
  if ((a.derivedFrom ?? null) !== (b.derivedFrom ?? null)) {
    const words = (d?: DatasetId) => (d ? datasetLabel(d) : "none");
    out.push(`Computed from: ${words(a.derivedFrom)} vs ${words(b.derivedFrom)}`);
  }
  if (a.mode !== b.mode) {
    out.push(`Read: ${readWords(a)} vs ${readWords(b)}`);
  } else if ((toIsoTime(a.readAt) ?? a.readAt) !== (toIsoTime(b.readAt) ?? b.readAt)) {
    out.push(`${a.mode === "cached" ? "Snapshot time" : "Read time"}: ${formatStampTime(a.readAt)} vs ${formatStampTime(b.readAt)}`);
  }
  if (a.runId !== b.runId) out.push(`Run: ${a.runId ?? "none"} vs ${b.runId ?? "none"}`);
  if (a.methodVersion !== b.methodVersion) out.push(`Statistics method version: ${a.methodVersion} vs ${b.methodVersion}`);
  if (a.counting !== b.counting) out.push(`Counting: ${countingLabel(a.counting)} vs ${countingLabel(b.counting)}`);
  const aKeys = new Map(a.filters.map((f) => [f.key, f]));
  const bKeys = new Map(b.filters.map((f) => [f.key, f]));
  for (const f of b.filters) if (!aKeys.has(f.key)) out.push(`Filter added: ${f.label}`);
  for (const f of a.filters) if (!bKeys.has(f.key)) out.push(`Filter removed: ${f.label}`);
  return out;
}

const DATASET_IDS: readonly DatasetId[] = ["published_fee_catalog", "published_fee_rate_catalog", "fee_index_cache"];
const MODES: readonly StampMode[] = ["live", "cached"];
const COUNTING_RULES: readonly CountingRule[] = ["counted_once", "per_charter"];

/**
 * A stamp read back from saved JSON (a saved answer, a report) exactly as it was saved, or null
 * when the value is not a whole stamp. It never rebuilds or refreshes one: a saved item shows the
 * stamp it was saved with, and an older item saved without one shows none.
 */
export function readDatasetStamp(value: unknown): DatasetStamp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (!DATASET_IDS.includes(s.dataset as DatasetId) || !MODES.includes(s.mode as StampMode)) return null;
  if (s.derivedFrom !== undefined && !DATASET_IDS.includes(s.derivedFrom as DatasetId)) return null;
  if (!COUNTING_RULES.includes(s.counting as CountingRule)) return null;
  if (typeof s.readAt !== "string" || toIsoTime(s.readAt) === null) return null;
  if (s.runId !== null && !(typeof s.runId === "number" && Number.isSafeInteger(s.runId))) return null;
  if (s.newestRecordAt !== null && typeof s.newestRecordAt !== "string") return null;
  if (typeof s.methodVersion !== "number" || !Number.isFinite(s.methodVersion)) return null;
  if (typeof s.id !== "string" || !s.id.startsWith("ds_")) return null;
  if (!Array.isArray(s.filters)) return null;
  const filters: PopulationFilter[] = [];
  for (const f of s.filters as unknown[]) {
    const filter = f as Partial<PopulationFilter> | null;
    if (!filter || typeof filter !== "object" || typeof filter.key !== "string" || typeof filter.label !== "string") return null;
    filters.push({ key: filter.key, label: filter.label });
  }
  return {
    dataset: s.dataset as DatasetId,
    ...(s.derivedFrom ? { derivedFrom: s.derivedFrom as DatasetId } : {}),
    mode: s.mode as StampMode,
    readAt: s.readAt,
    runId: s.runId as number | null,
    newestRecordAt: s.newestRecordAt as string | null,
    methodVersion: s.methodVersion,
    counting: s.counting as CountingRule,
    filters,
    id: s.id,
  };
}
