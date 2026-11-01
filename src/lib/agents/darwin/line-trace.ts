import type { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { refileCategory } from "@/lib/fee-category-guard";
import { LINE_TRACE_STRATEGIES, sourceLineTrace, SOURCE_TRACE_VERSION, textSha256 } from "@/lib/source-line-trace";
import { DARWIN_RECHECK_STRATEGY } from "./verified-recheck";
import { DARWIN_VERIFY_STRATEGY, loadSourceTextRecords, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's line trace over live fees (plan step 6, Nov 1 2026). Every live fee has a
 * `source_document_id`, but until now none kept the line it was read from: Darwin's verify and
 * its verified recheck traced the line with the shared source check and threw it away. Both now
 * keep it (`detail.source_trace` on their attempts). The recheck reads a fee once per recheck
 * version, and on Nov 1 all but one of the 88,144 live fees had already been read at v5, so on its
 * own it would never revisit them. This pass is that revisit.
 *
 * Each Darwin verify step (not an institution-scoped run) takes the next window of
 * `LINE_TRACE_LIMIT` live fees below a cursor, newest first. The cursor is the lowest
 * `fee_verified_id` of the last window, kept on the run ledger (the `darwin.line_trace` event's
 * `next_below_id`; null once a sweep reaches the bottom, so the next sweep starts again at the
 * top). Fees in the window that already carry a trace on their document's newest completed text
(the trace's `text_sha256` equals that text's `text_hash`) are skipped, so a re-captured document
is traced again; a line-trace miss counts as done only for the text it was tried on; the rest are traced on their
 * document's newest stored text with the same `sourceLineFor` the recheck uses, one
 * `verify.line_trace` attempt each. The window bounds the work: never more than
 * `LINE_TRACE_LIMIT` attempt probes a step, however many fees are already traced. The pass stops
 * writing `LINE_TRACE_BUDGET_MS` after the window and its texts have loaded (always writing at
 * least one fee, so a slow load never stalls the cursor), and the cursor then stays where the last
 * written fee was.
 *
 * It holds, rejects, re-files and takes down nothing: a fee whose line it cannot find is only
 * counted (`untraced`, outcome `no_candidates`), since the source check already holds such fees at
 * verify time and the recheck re-reads live fees under today's rules. No model calls; no new table.
 */
export const DARWIN_LINE_TRACE_STRATEGY = { strategy: LINE_TRACE_STRATEGIES.trace, version: SOURCE_TRACE_VERSION } as const;
export const DARWIN_LINE_TRACE_EVENT = "darwin.line_trace";
/** Live fees per window: about 70 Darwin verify steps a day (Oct 25 - Nov 1) sweep the 88,144 in about 6-7 days. */
export const LINE_TRACE_LIMIT = 200;
/** The pass stops writing after this long, so it never holds a step near the tick's limit. */
export const LINE_TRACE_BUDGET_MS = 10_000;

export interface LineTraceResult {
  /** The cursor this window started below (null: the top), and the one the next window starts below. */
  belowId: number | null;
  nextBelowId: number | null;
  /** Live fees in the window, and those of them already carrying a trace (skipped). */
  window: number;
  alreadyTraced: number;
  /** Traced, with the line found verbatim in the text (a character span). */
  traced: number;
  /** Traced, but the check's line is rebuilt from several lines, so no character span. */
  tracedWithoutSpan: number;
  /** The source check traces no line for the fee on its document's newest text. */
  untraced: number;
  /** The document has no completed stored text. */
  noText: number;
  /** True when the time budget ran out before the window was done. */
  outOfTime: boolean;
  error?: string;
}

interface LineTraceRow extends RawFeeRow {
  fee_verified_id: number | string;
  canonical_fee_key: string;
  traced_already: boolean;
}

async function readCursor(db: SqlTag): Promise<number | null> {
  // agent_run_events_type_idx (event_type, created_at DESC): one index read.
  const [row] = await db<{ next_below_id: string | null }[]>`
    SELECT detail->>'next_below_id' AS next_below_id
      FROM agent_run_events
     WHERE event_type = ${DARWIN_LINE_TRACE_EVENT}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  const value = row?.next_below_id == null ? null : Number(row.next_below_id);
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The next window of live fees below the cursor, each with whether a trace is stored for it already. */
function selectWindow(db: SqlTag, belowId: number | null, limit: number): Promise<LineTraceRow[]> {
  return db<LineTraceRow[]>`
    WITH live AS (
      SELECT c.fee_verified_id
        FROM published_fee_catalog c
       WHERE (${belowId}::bigint IS NULL OR c.fee_verified_id < ${belowId}::bigint)
       ORDER BY c.fee_verified_id DESC
       LIMIT ${limit}::int
    )
    SELECT live.fee_verified_id, v.canonical_fee_key,
           r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
           r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions,
           r.source_document_id, r.amount_kind, r.rate_percent, r.product_name,
           -- Traced already only on the document's newest completed text: a re-captured document
           -- (new text_hash) is traced again. A miss counts only for the text it was tried on.
           EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint IN ('verified:' || live.fee_verified_id::text, 'raw:' || v.fee_raw_id::text)
                AND pa.strategy IN (${DARWIN_VERIFY_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_LINE_TRACE_STRATEGY.strategy})
                AND (pa.detail->'source_trace'->>'text_sha256' = cur.text_hash
                  OR (pa.strategy = ${DARWIN_LINE_TRACE_STRATEGY.strategy} AND pa.strategy_version = ${DARWIN_LINE_TRACE_STRATEGY.version}
                      AND NOT (pa.detail ? 'source_trace')
                      AND pa.detail->>'source_text_sha256' IS NOT DISTINCT FROM cur.text_hash))
           ) AS traced_already
      FROM live
      JOIN verified_fee_observations v ON v.fee_verified_id = live.fee_verified_id
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
      LEFT JOIN agent_source_texts cur ON cur.source_document_id = r.source_document_id AND cur.status = 'completed'
     ORDER BY live.fee_verified_id DESC
  `;
}

export async function traceLiveFeeLines(
  db: SqlTag,
  options: { runId: number; stepId: number | null; limit?: number; budgetMs?: number; now?: () => number },
): Promise<LineTraceResult> {
  const now = options.now ?? Date.now;
  const budget = options.budgetMs ?? LINE_TRACE_BUDGET_MS;
  const result: LineTraceResult = {
    belowId: null, nextBelowId: null, window: 0, alreadyTraced: 0,
    traced: 0, tracedWithoutSpan: 0, untraced: 0, noText: 0, outOfTime: false,
  };
  const limit = Math.max(1, Math.min(options.limit ?? LINE_TRACE_LIMIT, 1_000));
  let rows: LineTraceRow[];
  try {
    result.belowId = await inSavepoint(db, readCursor);
    rows = await inSavepoint(db, (scope) => selectWindow(scope, result.belowId, limit));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
  result.window = rows.length;
  // A short window reached the bottom: the next sweep starts again at the top.
  let nextBelowId: number | null = rows.length < limit ? null : Number(rows[rows.length - 1].fee_verified_id);
  const todo = rows.filter((row) => !row.traced_already && row.source_document_id != null);
  result.alreadyTraced = rows.filter((row) => row.traced_already).length;
  const records = todo.length === 0 ? new Map<number, { id: number; text: string }>() : await inSavepoint(db, (scope) =>
    loadSourceTextRecords(scope, Array.from(new Set(todo.map((row) => Number(row.source_document_id))))));
  const texts = new Map(Array.from(records, ([documentId, record]) => [documentId, record.text]));
  // The budget clock starts once the window and its texts are loaded, and at least one fee is
  // always written: a slow load must not leave the cursor on the same window forever.
  const startedAt = now();
  let written = 0;
  for (const row of todo) {
    const id = Number(row.fee_verified_id);
    if (written > 0 && now() - startedAt > budget) {
      // Out of time: the next window starts at this fee, so none is skipped.
      result.outOfTime = true;
      nextBelowId = id + 1;
      break;
    }
    const documentId = Number(row.source_document_id);
    const record = records.get(documentId);
    const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
    const line = record ? sourceLineFor(row, texts, canonicalFeeKey) : null;
    const trace = record && line ? sourceLineTrace(record.text, record.id, line) : null;
    written += 1;
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
      // Neutral outcomes: a missing line is no evidence against the fee (the source check judges that).
      outcome: !record ? "empty" : trace ? "ok" : "no_candidates",
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
        // The text tried, so a miss is retried once the document is re-captured.
        source_text_sha256: trace?.text_sha256 ?? (record ? textSha256(record.text) : null),
        ...(trace ? { source_trace: trace } : { trace_miss: record ? "not_traced" : "no_source_text" }),
      },
    })).catch((error: unknown) => {
      result.error = error instanceof Error ? error.message : String(error);
    });
  }
  result.nextBelowId = nextBelowId;
  // The step's report, which also carries the cursor for the next step.
  await inSavepoint(db, (scope) => scope`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, ${options.stepId}, ${DARWIN_LINE_TRACE_EVENT}, 'completed',
      ${`Line trace: ${result.window} live fee(s) in the window, ${result.alreadyTraced} already traced, ${result.traced + result.tracedWithoutSpan} traced (${result.tracedWithoutSpan} without a span), ${result.untraced} not traced, ${result.noText} with no stored text${result.outOfTime ? "; stopped at its time budget" : ""}.`},
      ${JSON.stringify({ below_id: result.belowId, next_below_id: result.nextBelowId, window: result.window, already_traced: result.alreadyTraced, traced: result.traced, traced_without_span: result.tracedWithoutSpan, untraced: result.untraced, no_text: result.noText, out_of_time: result.outOfTime })}::jsonb
    )
  `).catch((error: unknown) => {
    result.error = error instanceof Error ? error.message : String(error);
  });
  return result;
}
