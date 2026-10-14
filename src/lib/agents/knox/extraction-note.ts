import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Knox's audit note for a read ("Knox deterministic extraction from Rosetta artifact #N.
 * canonical_hint=...; text_hash=...; calibrated_confidence=...; excerpt=\"...\"") has its own column,
 * `raw_fee_observations.extraction_note` (#1234 step 2, migration 20270110000048). `conditions`
 * holds only the bank's own condition text.
 *
 * Every read of the note goes through `COALESCE(extraction_note, conditions)`: in SQL as
 * `extractionNoteSql(alias)`, in code as `extractionNoteOf(row)`. A row whose note has not moved
 * yet reads the same as one that has, so the move can run in batches after deploy.
 */
export function extractionNoteOf(row: { extraction_note?: string | null; conditions?: string | null } | null | undefined): string | null {
  return row?.extraction_note ?? row?.conditions ?? null;
}

/** The note as SQL for a raw-row alias (`fr` → `COALESCE(fr.extraction_note, fr.conditions)`). */
export function extractionNoteSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`bad alias ${alias}`);
  return `COALESCE(${alias}.extraction_note, ${alias}.conditions)`;
}

/** Rows moved per step; about 238,000 Knox rows held the note on Oct 14, so about a dozen steps. */
export const EXTRACTION_NOTE_MOVE_LIMIT = 20_000;
export const EXTRACTION_NOTE_MOVE_EVENT = "knox.extraction_note_moved";

/**
 * A Knox row whose `conditions` is one of Knox's notes and nothing else: it starts with Knox's
 * lead ("Knox ... from Rosetta artifact #N.") and ends on the note's closing excerpt quote. All
 * 237,519 Knox rows with a note had this shape on Oct 14 (read-only count), so none holds bank
 * text beside it. A row of any other shape is left as it is; its reads still work.
 */
const NOTE_ONLY_SQL = `fr.source = 'knox'
  AND fr.extraction_note IS NULL
  AND fr.conditions LIKE 'Knox %'
  AND fr.conditions LIKE '%Rosetta artifact #%'
  AND position('excerpt="' IN fr.conditions) > 0
  AND right(rtrim(fr.conditions), 1) = '"'`;

export interface ExtractionNoteMoveResult {
  /** Rows moved this step (a dry run counts the rows it would move, up to the limit). */
  moved: number;
  /** Rows still holding a note in `conditions` after this step (null when the count failed). */
  remaining: number | null;
  dryRun: boolean;
}

/**
 * The move (#1234 step 2): for a batch of note-only Knox rows, `extraction_note` takes the whole
 * `conditions` text and `conditions` becomes NULL. Exact: the note is copied byte for byte.
 * Ledger: one `knox.extraction_note_moved` event per step that moves rows, and the counts in the
 * publish step's detail. Rollback: `UPDATE raw_fee_observations SET conditions = extraction_note,
 * extraction_note = NULL WHERE source = 'knox' AND conditions IS NULL AND extraction_note IS NOT NULL`.
 */
export async function moveExtractionNotes(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; limit?: number },
): Promise<ExtractionNoteMoveResult> {
  const limit = Math.max(1, Math.min(options.limit ?? EXTRACTION_NOTE_MOVE_LIMIT, EXTRACTION_NOTE_MOVE_LIMIT));
  const result: ExtractionNoteMoveResult = { moved: 0, remaining: null, dryRun: options.dryRun };
  try {
    await inSavepoint(db, async (scope) => {
      if (options.dryRun) {
        const [row] = await scope.unsafe<{ n: number | string }[]>(
          `SELECT count(*) AS n FROM (SELECT 1 FROM raw_fee_observations fr WHERE ${NOTE_ONLY_SQL} LIMIT $1) picked`,
          [limit],
        );
        result.moved = Number(row?.n ?? 0);
        return;
      }
      const moved = await scope.unsafe<{ fee_raw_id: number | string }[]>(
        `WITH picked AS (
           SELECT fr.fee_raw_id FROM raw_fee_observations fr
            WHERE ${NOTE_ONLY_SQL}
            ORDER BY fr.fee_raw_id
            LIMIT $1
         )
         UPDATE raw_fee_observations fr
            SET extraction_note = fr.conditions,
                conditions = NULL
           FROM picked
          WHERE fr.fee_raw_id = picked.fee_raw_id
            AND fr.extraction_note IS NULL
         RETURNING fr.fee_raw_id`,
        [limit],
      );
      result.moved = moved.length;
    });
    // Counted only while rows are moving, so a finished move costs one empty scan per step.
    if (result.moved > 0) {
      const [left] = await inSavepoint(db, (scope) =>
        scope.unsafe<{ n: number | string }[]>(`SELECT count(*) AS n FROM raw_fee_observations fr WHERE ${NOTE_ONLY_SQL}`),
      );
      result.remaining = left == null ? null : Number(left.n);
    } else {
      result.remaining = 0;
    }
  } catch (error) {
    console.error("moveExtractionNotes failed:", error);
    return result;
  }
  if (!options.dryRun && result.moved > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${EXTRACTION_NOTE_MOVE_EVENT}, 'completed',
          ${`Moved Knox's note out of conditions on ${result.moved} raw fee row(s)`},
          ${JSON.stringify({ moved: result.moved, remaining: result.remaining, issue: 1234 })}::jsonb
        )
      `);
    } catch (error) {
      console.error("extraction note move event failed:", error);
    }
  }
  return result;
}
