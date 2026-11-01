import { sql } from "./connection";
import { LINE_TRACE_STRATEGIES, parseSourceLineTrace } from "@/lib/source-line-trace";

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
