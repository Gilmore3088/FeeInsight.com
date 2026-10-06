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
 * source check share it. A failed fetch never supersedes a good copy.
 */

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
 * Makes this document the current copy of its page and supersedes the page's other
 * successful copies. Returns how many older copies it newly marked. Does nothing for a
 * failed document or before the migration is applied.
 */
export async function markCurrentCopy(db: SqlTag, sourceDocumentId: number | null): Promise<number> {
  if (sourceDocumentId == null) return 0;
  if (!(await currentCopySchemaReady(db))) return 0;
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
