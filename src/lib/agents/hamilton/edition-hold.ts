import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { EDITION_HEAD_CHARS, isoDay, notYetEffective } from "@/lib/agents/hamilton/schedule-edition";

type SqlTag = typeof sql;

/**
 * #1915: the publish step holds a row read from a schedule that is not in effect yet (Avidia's
 * "Effective December 1, 2026" schedule, read Oct 12). Like the thin-institution hold, a held row is
 * left out of the step's results and attempt log, so it stays selectable and publishes on the first
 * step on or after its effective date. Darwin's `darwin.edition_effective_check` takes down live rows
 * of such schedules and retires the older edition once the new one takes effect.
 */
export interface EditionHoldRow {
  fee_verified_id: number | string;
  source_document_id?: number | string | null;
}

/** Pure: the rows whose document's heading states an edition after `today`, by verified id, with that date. */
export function editionHolds(rows: EditionHoldRow[], heads: Map<string, string>, today: string): Map<number, string> {
  const held = new Map<number, string>();
  for (const row of rows) {
    if (row.source_document_id == null) continue;
    const date = notYetEffective(heads.get(String(row.source_document_id)), today);
    if (date) held.set(Number(row.fee_verified_id), date);
  }
  return held;
}

/**
 * Reads the heading of each selected row's latest stored document text and returns the rows to hold.
 * A failed read holds nothing: Darwin's live check takes such a row down on its next step.
 */
export async function selectEditionHolds(db: SqlTag, rows: EditionHoldRow[], now: Date = new Date()): Promise<Map<number, string>> {
  const documentIds = [...new Set(rows.map((row) => row.source_document_id).filter((id) => id != null).map(Number))];
  if (documentIds.length === 0) return new Map();
  try {
    const heads = await inSavepoint(db, (scope) => scope.unsafe<{ source_document_id: number | string; head: string | null }[]>(
      `SELECT DISTINCT ON (t.source_document_id) t.source_document_id, left(t.normalized_text, $2::int) AS head
         FROM agent_source_texts t
        WHERE t.status = 'completed'
          AND t.source_document_id = ANY($1::bigint[])
        ORDER BY t.source_document_id, t.id DESC`,
      [documentIds, EDITION_HEAD_CHARS],
    ));
    if (!Array.isArray(heads)) return new Map();
    return editionHolds(rows, new Map(heads.map((row) => [String(row.source_document_id), row.head ?? ""])), isoDay(now));
  } catch (error) {
    console.warn("[hamilton] edition hold read failed", error instanceof Error ? error.message : error);
    return new Map();
  }
}
