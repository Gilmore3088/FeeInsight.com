import type { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { refileCategory } from "@/lib/fee-category-guard";
import { LINE_TRACE_STRATEGIES, sourceLineTrace, SOURCE_TRACE_VERSION } from "@/lib/source-line-trace";
import { DARWIN_RECHECK_STRATEGY } from "./verified-recheck";
import { DARWIN_VERIFY_STRATEGY, loadSourceTextRecords, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's line trace over live fees (plan step 6, Nov 1 2026). Every live fee has a
 * `source_document_id`, but until now none kept the line it was read from: Darwin's verify and
 * its verified recheck traced the line with the shared source check and threw it away. Both now
 * keep it (`detail.source_trace` on their attempts). The recheck reads a fee once per recheck
 * version, and on Nov 1 all but one of the 88,144 live fees had already been read at v5, so on its
 * own it would never revisit them. This pass is that revisit: each Darwin verify step reads up to
 * `LINE_TRACE_LIMIT` live fees that carry no trace, newest first, traces each on its document's
 * newest stored text with the same `sourceLineFor` the recheck uses, and records one
 * `verify.line_trace` attempt per fee.
 *
 * It holds, rejects, re-files and takes down nothing: a fee whose line it cannot find is only
 * counted (`untraced`), since the source check already holds such fees at verify time and the
 * recheck re-reads live fees under today's rules. No model calls; no new table.
 */
export const DARWIN_LINE_TRACE_STRATEGY = { strategy: LINE_TRACE_STRATEGIES.trace, version: SOURCE_TRACE_VERSION } as const;
/** Live fees traced per Darwin verify step: about 70 steps a day (Oct 25 - Nov 1) read the 88,144 in about a week. */
export const LINE_TRACE_LIMIT = 200;

export interface LineTraceResult {
  selected: number;
  /** Traced, with the line found verbatim in the text (a character span). */
  traced: number;
  /** Traced, but the check's line is rebuilt from several lines, so no character span. */
  tracedWithoutSpan: number;
  /** The source check traces no line for the fee on its document's newest text. */
  untraced: number;
  /** The document has no completed stored text. */
  noText: number;
  error?: string;
}

interface LineTraceRow extends RawFeeRow {
  fee_verified_id: number | string;
  canonical_fee_key: string;
}

function selectUntracedLiveFees(db: SqlTag, limit: number): Promise<LineTraceRow[]> {
  return db<LineTraceRow[]>`
    SELECT c.fee_verified_id, v.canonical_fee_key,
           r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
           r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions,
           r.source_document_id, r.amount_kind, r.rate_percent, r.product_name
      FROM published_fee_catalog c
      JOIN verified_fee_observations v ON v.fee_verified_id = c.fee_verified_id
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE r.source_document_id IS NOT NULL
       -- One probe of pipeline_attempts_input_idx per fee: a stored trace on any of Darwin's
       -- attempts, or this pass's own attempt at this version (a miss is not read again).
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.input_fingerprint IN ('verified:' || c.fee_verified_id::text, 'raw:' || v.fee_raw_id::text)
            AND pa.strategy IN (${DARWIN_VERIFY_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_LINE_TRACE_STRATEGY.strategy})
            AND (pa.detail ? 'source_trace'
              OR (pa.strategy = ${DARWIN_LINE_TRACE_STRATEGY.strategy} AND pa.strategy_version = ${DARWIN_LINE_TRACE_STRATEGY.version}))
       )
     ORDER BY c.fee_verified_id DESC
     LIMIT ${limit}::int
  `;
}

export async function traceLiveFeeLines(
  db: SqlTag,
  options: { runId: number; stepId: number | null; limit?: number },
): Promise<LineTraceResult> {
  const result: LineTraceResult = { selected: 0, traced: 0, tracedWithoutSpan: 0, untraced: 0, noText: 0 };
  const limit = Math.max(1, Math.min(options.limit ?? LINE_TRACE_LIMIT, 1_000));
  let rows: LineTraceRow[];
  try {
    rows = await inSavepoint(db, (scope) => selectUntracedLiveFees(scope, limit));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
  result.selected = rows.length;
  if (rows.length === 0) return result;
  const records = await inSavepoint(db, (scope) =>
    loadSourceTextRecords(scope, Array.from(new Set(rows.map((row) => Number(row.source_document_id))))));
  const texts = new Map(Array.from(records, ([documentId, record]) => [documentId, record.text]));
  for (const row of rows) {
    const id = Number(row.fee_verified_id);
    const documentId = Number(row.source_document_id);
    const record = records.get(documentId);
    const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
    const line = record ? sourceLineFor(row, texts, canonicalFeeKey) : null;
    const trace = record && line ? sourceLineTrace(record.text, record.id, line) : null;
    if (!record) result.noText += 1;
    else if (!trace) result.untraced += 1;
    else if (trace.char_start == null) result.tracedWithoutSpan += 1;
    else result.traced += 1;
    await inSavepoint(db, (scope) => recordAttempt(scope, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: documentId,
      stage: "verify",
      strategy: DARWIN_LINE_TRACE_STRATEGY.strategy,
      version: DARWIN_LINE_TRACE_STRATEGY.version,
      fingerprint: `verified:${id}`,
      outcome: !record ? "empty" : trace ? "ok" : "evidence_mismatch",
      yieldCount: trace ? 1 : 0,
      costMicrousd: 0,
      runId: options.runId,
      stepId: options.stepId,
      foldIntoPlaybook: false,
      detail: {
        fee_verified_id: id,
        fee_raw_id: Number(row.fee_raw_id),
        canonical_fee_key: canonicalFeeKey,
        source_text_id: record?.id ?? null,
        ...(trace ? { source_trace: trace } : { trace_miss: record ? "not_traced" : "no_source_text" }),
      },
    })).catch((error: unknown) => {
      result.error = error instanceof Error ? error.message : String(error);
    });
  }
  return result;
}
