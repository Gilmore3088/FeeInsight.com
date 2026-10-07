import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * One current document per page. A page is an institution's document_url; Magellan stores
 * a new source_documents row whenever that page's content changes, so a page collects
 * many copies. The copy a fetch last stored or confirmed is the current one
 * (superseded_by_id NULL); every other successful copy of the page points at it and is
 * history. Nothing is deleted: fees, texts and attempts keep the document they cite.
 *
 * Current copy of a page = status 'success' AND duplicate_of_id IS NULL AND
 * superseded_by_id IS NULL. Knox reads the current copy and Rosetta, Knox and the
 * source check share it. A failed fetch never supersedes a good copy, and neither does a
 * copy Rosetta read as a bot check, a script shell or a bare title (`thin copy`): the page's
 * latest copy with a readable text stays current until a readable newer copy arrives.
 */

/** A text this short that is not a fee page is a bot check, a script shell or a bare title. */
export const THIN_COPY_MAX_CHARS = 300;
/** Pages `restoreReadableCopies` puts back on a readable copy per call. */
export const RESTORE_READABLE_COPY_LIMIT = 50;

const readyCache = new WeakMap<object, boolean>();

/** False until the superseded_by_id migration is applied. */
export async function currentCopySchemaReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  try {
    const [row] = await db`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'source_documents'
           AND column_name = 'superseded_by_id'
      ) AS ready
    `;
    const ready = row?.ready === true;
    if (ready) readyCache.set(db, true);
    return ready;
  } catch {
    return false;
  }
}

/**
 * The page's latest other copy with a readable text, when this copy's own text (of its
 * current content) is a thin copy. Null otherwise, including before Rosetta reads it.
 */
async function readableCopyFor(db: SqlTag, sourceDocumentId: number): Promise<number | null> {
  const [row] = await db`
    SELECT keep.id
      FROM source_documents cur
      JOIN agent_source_texts thin
        ON thin.source_document_id = cur.id
       AND thin.status <> 'completed'
       AND COALESCE(thin.char_count, 0) < ${THIN_COPY_MAX_CHARS}
       AND thin.source_hash = cur.content_hash
      JOIN source_documents keep
        ON keep.institution_id = cur.institution_id
       AND keep.document_url = cur.document_url
       AND keep.id <> cur.id
       AND keep.status = 'success'
       AND keep.duplicate_of_id IS NULL
      JOIN agent_source_texts readable
        ON readable.source_document_id = keep.id
       AND readable.status = 'completed'
       AND readable.char_count > 0
     WHERE cur.id = ${sourceDocumentId}
     ORDER BY keep.id DESC
     LIMIT 1
  `;
  return row?.id == null ? null : Number(row.id);
}

/**
 * Makes this document the current copy of its page and supersedes the page's other
 * successful copies. Returns how many older copies it newly marked. Does nothing for a
 * failed document or before the migration is applied. A thin copy hands the place to the
 * page's latest readable copy instead.
 */
export async function markCurrentCopy(db: SqlTag, documentId: number | null): Promise<number> {
  if (documentId == null) return 0;
  if (!(await currentCopySchemaReady(db))) return 0;
  const sourceDocumentId = (await readableCopyFor(db, documentId)) ?? documentId;
  await db`
    UPDATE source_documents
       SET superseded_by_id = NULL
     WHERE id = ${sourceDocumentId}
       AND status = 'success'
       AND superseded_by_id IS NOT NULL
  `;
  const superseded = await db`
    UPDATE source_documents other
       SET superseded_by_id = cur.id
      FROM source_documents cur
     WHERE cur.id = ${sourceDocumentId}
       AND cur.status = 'success'
       AND cur.document_url IS NOT NULL
       AND other.institution_id = cur.institution_id
       AND other.document_url = cur.document_url
       AND other.id <> cur.id
       AND other.status = 'success'
       AND other.duplicate_of_id IS NULL
       AND other.superseded_by_id IS DISTINCT FROM cur.id
    RETURNING other.id
  `;
  return Array.isArray(superseded) ? superseded.length : 0;
}

/**
 * Puts pages whose current copy Rosetta read as a thin copy back on their latest readable
 * copy (Rosetta's read step runs it). Returns the thin copies moved aside and how many
 * copies were re-pointed.
 */
export async function restoreReadableCopies(
  db: SqlTag,
  options: { limit?: number; institutionId?: number; dryRun?: boolean } = {},
): Promise<{ thinCopies: number[]; superseded: number }> {
  if (!(await currentCopySchemaReady(db))) return { thinCopies: [], superseded: 0 };
  const limit = Math.max(0, Math.min(options.limit ?? RESTORE_READABLE_COPY_LIMIT, RESTORE_READABLE_COPY_LIMIT));
  const institutionId = options.institutionId ?? null;
  const rows = await db<Array<{ id: number | string }>>`
    SELECT cur.id
      FROM source_documents cur
      JOIN agent_source_texts thin
        ON thin.source_document_id = cur.id
       AND thin.status <> 'completed'
       AND COALESCE(thin.char_count, 0) < ${THIN_COPY_MAX_CHARS}
       AND thin.source_hash = cur.content_hash
     WHERE cur.status = 'success'
       AND cur.duplicate_of_id IS NULL
       AND cur.superseded_by_id IS NULL
       AND cur.document_url IS NOT NULL
       AND (${institutionId}::bigint IS NULL OR cur.institution_id = ${institutionId}::bigint)
       AND EXISTS (
         SELECT 1
           FROM source_documents keep
           JOIN agent_source_texts readable
             ON readable.source_document_id = keep.id
            AND readable.status = 'completed'
            AND readable.char_count > 0
          WHERE keep.institution_id = cur.institution_id
            AND keep.document_url = cur.document_url
            AND keep.id <> cur.id
            AND keep.status = 'success'
            AND keep.duplicate_of_id IS NULL
       )
     ORDER BY cur.id
     LIMIT ${limit}
  `;
  const thinCopies = rows.map((row) => Number(row.id));
  if (options.dryRun) return { thinCopies, superseded: 0 };
  let superseded = 0;
  for (const id of thinCopies) superseded += await markCurrentCopy(db, id);
  return { thinCopies, superseded };
}
