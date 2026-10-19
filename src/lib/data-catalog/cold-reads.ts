import { sql } from "@/lib/data-store/connection";
import { decodeColdFile, getColdStore, type ColdStore } from "@/lib/agents/hoovie/cold-files";
import type { CallInstitutionRow, CallRollupRow } from "./roll-ups";
import { ncuaCallMeasure } from "./ncua-call-measures";

/**
 * Cold reads (#1870): a call-report quarter whose hot rows were pruned from Postgres is read from
 * its file in R2 (`src/lib/agents/hoovie/cold-files.ts`), through the same rows and citation as a
 * hot read. Only periods whose index row has `pruned_at` set are read here; while a period is
 * still in Postgres, Postgres answers. Pruning itself waits for James's yes, so until then this
 * finds no files and adds nothing.
 *
 * A file is checked against its index row (SHA-256 and row count) before any figure is used.
 */

/** Most cold files one query reads; older quarters need a narrower period. */
export const MAX_COLD_FILES_PER_QUERY = 4;
const INDEX_CACHE_MS = 10 * 60 * 1000;

export interface ColdFileRef {
  source: string;
  period: string;
  objectKey: string;
  rowCount: number;
  sha256: string;
}

let indexCache: { at: number; files: ColdFileRef[] } | null = null;

/** Test hook. */
export function clearColdIndexCache(): void {
  indexCache = null;
}

/** Pruned call-report periods that live only in files. Empty when the index table is missing or unreadable. */
export async function prunedCallFiles(now = Date.now()): Promise<ColdFileRef[]> {
  if (indexCache && now - indexCache.at < INDEX_CACHE_MS) return indexCache.files;
  let files: ColdFileRef[] = [];
  try {
    const rows = await sql<Array<{ source: string; period: string; object_key: string; row_count: string | number; sha256: string }>>`
      SELECT source, period, object_key, row_count, sha256
        FROM public_data_cold_files
       WHERE table_name = 'institution_call_report_items' AND pruned_at IS NOT NULL
    `;
    files = rows.map((r) => ({ source: r.source, period: r.period, objectKey: r.object_key, rowCount: Number(r.row_count), sha256: r.sha256 }));
  } catch {
    files = [];
  }
  indexCache = { at: now, files };
  return files;
}

/** A filing period is covered independently for each regulator. */
export function callSourcePeriodKey(source: string, period: string): string {
  return JSON.stringify([source, period]);
}

/**
 * Pure: the files a query needs, newest first: the row sources it reads, inside the month bounds
 * (same rule as the hot query: the report date's YYYY-MM), excluding only source/periods Postgres answered.
 */
export function coldFilesInRange(
  files: readonly ColdFileRef[],
  args: { rowSources: readonly string[]; from: string | null; to: string | null; hotSourcePeriods: ReadonlySet<string> },
): ColdFileRef[] {
  return files
    .filter((f) => args.rowSources.includes(f.source))
    .filter((f) => !args.hotSourcePeriods.has(callSourcePeriodKey(f.source, f.period)))
    .filter((f) => (args.from == null || f.period.slice(0, 7) >= args.from) && (args.to == null || f.period.slice(0, 7) <= args.to))
    .sort((a, b) => (a.period === b.period ? a.source.localeCompare(b.source) : a.period < b.period ? 1 : -1));
}

export interface ColdCallRow {
  institution_id: number;
  source: string;
  report_date: string;
  item_code: string;
  item_key: string;
  item_description: string | null;
  schedule: string | null;
  value: number;
  unit: string;
  period_basis: string;
  source_url: string | null;
  fetched_at: string | null;
}

/** Pure: an archived value that is absent, not a reported figure (null, blank or not a number). */
export function missingColdValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (typeof value !== "number" && typeof value !== "string") return true;
  return !Number.isFinite(Number(value));
}

/**
 * Reads one line item from the given files. A file that fails its checks is reported, not used.
 * A row whose value is missing (null, blank or not a number) is never read as zero (#2315); it is
 * left out and its file is named in `incomplete`, since production call-report values are never null.
 */
export async function readColdCallRows(
  files: readonly ColdFileRef[],
  filter: { itemKey: string; institutionIds: readonly number[] | null },
  store: ColdStore = getColdStore(),
): Promise<{ rows: ColdCallRow[]; failed: string[]; incomplete?: string[] }> {
  const rows: ColdCallRow[] = [];
  const failed: string[] = [];
  const incomplete: string[] = [];
  const members = filter.institutionIds ? new Set(filter.institutionIds.map(String)) : null;
  const measure = ncuaCallMeasure(filter.itemKey);
  // Item keys are [a-z0-9_] (queryData's schema), so the quoted key is a safe substring test.
  const needle = JSON.stringify(filter.itemKey);
  for (const file of files) {
    let missing = 0;
    try {
      const decoded = decodeColdFile(await store.get(file.objectKey), {
        expected: { sha256: file.sha256, rowCount: file.rowCount },
        lineFilter: (line) => line.includes(needle),
      });
      for (const row of decoded.rows) {
        if (row.item_key !== filter.itemKey) continue;
        // Index provenance also constrains each decoded row; a checksum alone proves integrity,
        // not that the file contains the indexed publisher and quarter.
        if (row.source !== file.source || row.report_date !== file.period) continue;
        if (measure && (row.source !== "ncua" || row.item_code !== measure.code || row.unit !== measure.storedUnit || row.period_basis !== measure.periodBasis)) continue;
        if (members && !members.has(String(row.institution_id))) continue;
        // A missing figure is not a reported zero, for every line item, curated or generic (#2315).
        if (missingColdValue(row.value)) {
          missing += 1;
          continue;
        }
        const value = Number(row.value);
        rows.push({
          institution_id: Number(row.institution_id),
          source: String(row.source),
          report_date: String(row.report_date),
          item_code: String(row.item_code),
          item_key: String(row.item_key),
          item_description: row.item_description == null ? null : String(row.item_description),
          schedule: row.schedule == null ? null : String(row.schedule),
          value,
          unit: String(row.unit),
          period_basis: String(row.period_basis),
          source_url: row.source_url == null ? null : String(row.source_url),
          fetched_at: row.fetched_at == null ? null : String(row.fetched_at),
        });
      }
    } catch {
      failed.push(`${file.source} ${file.period}`);
      continue;
    }
    if (missing > 0) incomplete.push(`${file.source} ${file.period} (${missing} row${missing === 1 ? "" : "s"} missing a value)`);
  }
  return { rows, failed, incomplete };
}

/**
 * Archive integrity is not institution identity. Apply the same current canonical
 * charter/source boundary as the hot SQL before either a series or a median is shaped.
 */
export function canonicalColdCallRows(
  rows: readonly ColdCallRow[],
  identities: readonly { id: number | string; charter_type: unknown }[],
): ColdCallRow[] {
  const charterById = new Map(identities.map((identity) => [String(identity.id), identity.charter_type]));
  return rows.filter((row) => {
    if (!Number.isSafeInteger(row.institution_id) || row.institution_id <= 0) return false;
    const charter = charterById.get(String(row.institution_id));
    return (charter === "bank" && row.source === "ffiec") || (charter === "credit_union" && row.source === "ncua");
  });
}

/** Same conversion as the hot reads: FFIEC thousands become dollars; counts stay counts. */
function comparable(row: ColdCallRow): { value: number; unit: string } {
  return { value: row.unit === "thousands" ? row.value * 1000 : row.value, unit: row.unit === "count" ? "count" : "USD" };
}

/** Pure: one institution's cold rows in the hot series' shape. */
export function coldInstitutionSeries(rows: readonly ColdCallRow[]): CallInstitutionRow[] {
  return rows.map((row) => {
    const { value, unit } = comparable(row);
    return {
      period: row.report_date,
      item_code: row.item_code,
      item_description: row.item_description,
      schedule: row.schedule,
      value,
      unit,
      period_basis: row.period_basis,
      source: row.source,
      source_url: row.source_url,
      fetched_at: row.fetched_at,
    };
  });
}

/** Postgres percentile_cont over sorted values. */
export function percentileCont(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Pure: the hot roll-up (callPeerRollup), keeping period bases and units separate. */
export function coldCallRollup(rows: readonly ColdCallRow[], subjectId?: number | null): CallRollupRow[] {
  const groups = new Map<string, ColdCallRow[]>();
  for (const row of rows) {
    const key = `${row.report_date}|${comparable(row).unit}|${row.period_basis}|${row.source}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: CallRollupRow[] = [];
  for (const [key, list] of groups) {
    const [period, unit, periodBasis] = key.split("|");
    const values = list.map((r) => comparable(r).value).sort((a, b) => a - b);
    const newest = [...list].sort((a, b) => (b.fetched_at ?? "").localeCompare(a.fetched_at ?? ""))[0];
    out.push({
      period,
      unit,
      median: percentileCont(values, 0.5),
      p25: percentileCont(values, 0.25),
      p75: percentileCont(values, 0.75),
      institution_count: new Set(list.map((r) => r.institution_id)).size,
      period_basis: periodBasis,
      sources: [...new Set(list.map((r) => r.source))].sort(),
      ...(subjectId !== undefined ? { subject_included: subjectId === null ? null : list.some((row) => row.institution_id === subjectId) } : {}),
      fetched_at: newest?.fetched_at ?? null,
      source_url: newest?.source_url ?? null,
    });
  }
  return out.sort((a, b) => (a.period === b.period ? a.unit.localeCompare(b.unit) || (a.period_basis ?? "").localeCompare(b.period_basis ?? "") : a.period < b.period ? 1 : -1));
}
