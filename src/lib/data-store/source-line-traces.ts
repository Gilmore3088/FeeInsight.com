import { sql } from "./connection";
import { LINE_TRACE_STRATEGIES, parseSourceLineTrace, textSha256 } from "@/lib/source-line-trace";
import { locateFeeInText, prepareSourceText, sourceLocationCitation, type SourceLocation, type SourceLocationMiss } from "@/lib/source-location";

type SqlTag = typeof sql;

/** The stored line shown under a live fee in the admin catalog (plan step 6). */
export interface FeeSourceLine {
  quote: string;
  lineNumber: number | null;
  textId: number | null;
}

/**
 * The newest stored source line of each live catalog row (`published_fee_catalog.id`), as Darwin
 * recorded it on its verify, recheck or line-trace attempt (`detail.source_trace`). Rows with no
 * stored line are left out. Read-only.
 */
export async function getFeeSourceLines(catalogIds: number[], db: SqlTag = sql): Promise<Record<number, FeeSourceLine>> {
  if (catalogIds.length === 0) return {};
  const rows = await db<{ id: number | string; trace: unknown }[]>`
    SELECT c.id, t.trace
      FROM published_fee_catalog c
      JOIN LATERAL (
        SELECT pa.detail->'source_trace' AS trace
          FROM pipeline_attempts pa
         WHERE pa.input_fingerprint IN ('verified:' || c.fee_verified_id::text, 'raw:' || c.fee_raw_id::text)
           AND pa.strategy IN (${LINE_TRACE_STRATEGIES.verify}, ${LINE_TRACE_STRATEGIES.recheck}, ${LINE_TRACE_STRATEGIES.trace})
           AND pa.detail ? 'source_trace'
         ORDER BY pa.id DESC
         LIMIT 1
      ) t ON true
     WHERE c.id = ANY(${catalogIds}::bigint[])
  `;
  const lines: Record<number, FeeSourceLine> = {};
  for (const row of rows) {
    const trace = parseSourceLineTrace(typeof row.trace === "string" ? JSON.parse(row.trace) : row.trace);
    if (trace) lines[Number(row.id)] = { quote: trace.quote, lineNumber: trace.line_number, textId: trace.text_id };
  }
  return lines;
}

/** Most catalog rows one call locates (each row's document text is read once per call). */
export const FEE_SOURCE_LOCATION_MAX_IDS = 100;
/** A stored text longer than this is not read for a location (none of the sample came near it). */
export const FEE_SOURCE_LOCATION_MAX_CHARS = 2_000_000;

/** A live fee's place in its stored document, with the text it was found in. */
export interface FeeSourceLocation extends SourceLocation {
  /** `agent_source_texts.id` and the SHA-256 of its `normalized_text`: the version the line counts in. */
  textId: number;
  textSha256: string;
}

export type FeeSourceLocationResult =
  | { location: FeeSourceLocation; miss: null }
  | { location: null; miss: SourceLocationMiss };

interface LocationRow {
  id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  amount: number | string | null;
  fee_name: string | null;
  extraction_note: string | null;
  conditions: string | null;
  trace: unknown;
}

interface TextRow {
  id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  /** Null when the newest text is longer than FEE_SOURCE_LOCATION_MAX_CHARS. */
  normalized_text: string | null;
  text_hash: string | null;
}

export interface FeeSourceLocationOptions {
  /**
   * Epoch ms after which no further document is read: the fees of the documents left are left out
   * of the result (neither found nor missed), so a caller with a deadline (a publish step) stops in time.
   */
  deadlineAt?: number;
  /** The clock, for tests. */
  now?: () => number;
}

function parseTrace(value: unknown): ReturnType<typeof parseSourceLineTrace> {
  try {
    return parseSourceLineTrace(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

/**
 * The page and line each live catalog row (`published_fee_catalog.id`) is printed on in its
 * document's newest completed stored text, found on read by `locateFeeInText` (no stored column
 * holds it: see `source-location.ts`). Each text is folded once for all its fees, so a long text
 * costs one fold per call, not one per fee. A newest text longer than
 * FEE_SOURCE_LOCATION_MAX_CHARS, or whose stored digest disagrees with it, gives `no_text` (never an
 * older copy's line). A row that is not found carries the reason and no position, so a caller never
 * names a line it does not have. Rows that are not live are left out. Read-only.
 */
export async function getFeeSourceLocations(
  catalogIds: number[],
  db: SqlTag = sql,
  options: FeeSourceLocationOptions = {},
): Promise<Map<number, FeeSourceLocationResult>> {
  const ids = [...new Set(catalogIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, FEE_SOURCE_LOCATION_MAX_IDS);
  const out = new Map<number, FeeSourceLocationResult>();
  if (ids.length === 0) return out;
  const now = options.now ?? Date.now;
  const rows = await db<LocationRow[]>`
    SELECT c.id, c.institution_id, c.source_document_id, c.amount, c.fee_name, c.extraction_note, c.conditions, t.trace
      FROM published_fee_catalog c
      LEFT JOIN LATERAL (
        SELECT pa.detail->'source_trace' AS trace
          FROM pipeline_attempts pa
         WHERE pa.input_fingerprint IN ('verified:' || c.fee_verified_id::text, 'raw:' || c.fee_raw_id::text)
           AND pa.strategy IN (${LINE_TRACE_STRATEGIES.verify}, ${LINE_TRACE_STRATEGIES.recheck}, ${LINE_TRACE_STRATEGIES.trace})
           AND pa.detail ? 'source_trace'
         ORDER BY pa.id DESC
         LIMIT 1
      ) t ON true
     WHERE c.id = ANY(${ids}::bigint[])
  `;
  const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const texts = new Map<string, { id: number; text: string; sha256: string }>();
  if (documentIds.length > 0) {
    // The newest completed text of each document first, then its length (measured for that text
    // only): a too-long newest text gives no location rather than an older copy's line.
    const textRows = await db<TextRow[]>`
      SELECT newest.id, newest.institution_id, newest.source_document_id, newest.text_hash,
             CASE WHEN length(newest.normalized_text) <= ${FEE_SOURCE_LOCATION_MAX_CHARS} THEN newest.normalized_text END AS normalized_text
        FROM (
          SELECT DISTINCT ON (ast.source_document_id, ast.institution_id)
                 ast.id, ast.institution_id, ast.source_document_id, ast.normalized_text, ast.text_hash
            FROM agent_source_texts ast
           WHERE ast.source_document_id = ANY(${documentIds}::bigint[])
             AND ast.status = 'completed'
             AND ast.normalized_text IS NOT NULL
           ORDER BY ast.source_document_id, ast.institution_id, ast.id DESC
        ) newest
    `;
    for (const row of textRows) {
      if (typeof row.normalized_text !== "string") continue;
      const sha256 = textSha256(row.normalized_text);
      // A text whose stored digest disagrees with its characters is not the version it says it is.
      if (row.text_hash != null && row.text_hash !== sha256) continue;
      texts.set(`${Number(row.institution_id)}:${Number(row.source_document_id)}`, { id: Number(row.id), text: row.normalized_text, sha256 });
    }
  }
  // One document's fees together, so its text is prepared once for all of them.
  const byDocument = new Map<string, LocationRow[]>();
  for (const row of rows) {
    const key = `${Number(row.institution_id)}:${Number(row.source_document_id)}`;
    byDocument.set(key, [...(byDocument.get(key) ?? []), row]);
  }
  for (const [key, documentRows] of byDocument) {
    if (options.deadlineAt != null && now() >= options.deadlineAt) break;
    const stored = texts.get(key);
    const prepared = stored ? prepareSourceText(stored.text) : null;
    for (const row of documentRows) {
      const trace = parseTrace(row.trace);
      const found = locateFeeInText({
        text: prepared,
        amount: row.amount,
        feeName: row.fee_name,
        extraction_note: row.extraction_note,
        conditions: row.conditions,
        tracedLine: trace?.quote ?? null,
      });
      out.set(Number(row.id), found.location && stored
        ? { location: { ...found.location, textId: stored.id, textSha256: stored.sha256 }, miss: null }
        : { location: null, miss: found.miss ?? "no_text" });
    }
  }
  return out;
}

/**
 * The citation words of each catalog row that was found ("page 2, line 4 of our stored copy of the bank's fee schedule"),
 * by catalog id. Never fails its caller: a read error gives no words, and the citation then names
 * no line, as for a row that was not found.
 */
export async function getFeeSourceCitations(catalogIds: number[], db: SqlTag = sql): Promise<Map<number, string>> {
  const citations = new Map<number, string>();
  try {
    for (const [id, result] of await getFeeSourceLocations(catalogIds, db)) {
      const words = sourceLocationCitation(result.location);
      if (words) citations.set(id, words);
    }
  } catch (error) {
    console.error("getFeeSourceLocations failed:", error);
  }
  return citations;
}

/** The rows, each found one with `sourceLocation` set to its citation words; the others unchanged. */
export async function withFeeSourceCitations<T extends { id: number }>(rows: T[], db: SqlTag = sql): Promise<Array<T & { sourceLocation?: string }>> {
  if (rows.length === 0) return rows;
  const citations = await getFeeSourceCitations(rows.map((row) => row.id), db);
  return rows.map((row) => (citations.has(row.id) ? { ...row, sourceLocation: citations.get(row.id)! } : row));
}
