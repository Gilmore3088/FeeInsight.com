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
 * One page, several spellings: "https://www.bank.com:443/fees" and "https://bank.com/fees/"
 * are the same page (urlIdentity in finders.ts: host without www or port, path without
 * trailing slashes, query kept). Matching on the exact address left both spellings
 * current, so Knox skipped the newer copy's identical text and its fees stayed on a copy
 * nothing superseded (Wailuku FCU, Oct 2026).
 */
export const PAGE_HOST_SQL = "^https?://(?:www\\.)?([^/:?#]+)";
export const PAGE_ORIGIN_SQL = "^https?://[^/?#]+";
export const PAGE_TRAILING_SLASH_SQL = "/+(\\?|$)";

/**
 * False runs the same-page match in shadow mode: each fetch step logs which current copies
 * another spelling of their page would supersede (`magellan.same_page_copies`) but changes
 * none, and exact-address superseding goes on as before.
 */
export const SAME_PAGE_SUPERSEDE_LIVE = false;
/** Older same-page copies marked (or, in shadow mode, logged) per fetch step. */
export const SAME_PAGE_COPY_LIMIT = 200;

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
       AND (
         other.document_url = cur.document_url
         OR (
           ${SAME_PAGE_SUPERSEDE_LIVE}::boolean
           AND other.document_url IS NOT NULL
           AND substring(lower(other.document_url) from ${PAGE_HOST_SQL}) = substring(lower(cur.document_url) from ${PAGE_HOST_SQL})
           AND regexp_replace(regexp_replace(split_part(other.document_url, '#', 1), ${PAGE_ORIGIN_SQL}, ''), ${PAGE_TRAILING_SLASH_SQL}, '\\1')
             = regexp_replace(regexp_replace(split_part(cur.document_url, '#', 1), ${PAGE_ORIGIN_SQL}, ''), ${PAGE_TRAILING_SLASH_SQL}, '\\1')
         )
       )
       AND other.id <> cur.id
       AND other.status = 'success'
       AND other.duplicate_of_id IS NULL
       AND other.superseded_by_id IS DISTINCT FROM cur.id
    RETURNING other.id
  `;
  return Array.isArray(superseded) ? superseded.length : 0;
}

export interface SamePageCopyResult {
  live: boolean;
  /** Current copies another, newer spelling of their page supersedes (or would). */
  copies: number;
  pairs: Array<{ olderDocumentId: number; currentDocumentId: number }>;
}

/**
 * Backfill for pages stored under two spellings: of each institution's current copies that
 * name the same page, the newest stays current and the others point at it, as a fetch of
 * that page now does. In shadow mode (SAME_PAGE_SUPERSEDE_LIVE false) it only logs the pairs.
 * Nothing is deleted and no fee is touched here; Hamilton's newer-copy check and identical-copy
 * move handle the fees as for any superseded copy.
 */
export async function supersedeSamePageCopies(
  db: SqlTag,
  options: { runId: number; live?: boolean; limit?: number; institutionId?: number | null },
): Promise<SamePageCopyResult> {
  const live = options.live ?? SAME_PAGE_SUPERSEDE_LIVE;
  const empty: SamePageCopyResult = { live, copies: 0, pairs: [] };
  if (!(await currentCopySchemaReady(db))) return empty;
  const rows = await db<Array<{ older_id: number | string; current_id: number | string }>>`
    -- same-page current copies
    WITH current_copies AS (
      SELECT doc.id, doc.institution_id, doc.crawled_at,
             substring(lower(doc.document_url) from ${PAGE_HOST_SQL})
               || regexp_replace(regexp_replace(split_part(doc.document_url, '#', 1), ${PAGE_ORIGIN_SQL}, ''), ${PAGE_TRAILING_SLASH_SQL}, '\\1') AS page
        FROM source_documents doc
       WHERE doc.status = 'success'
         AND doc.duplicate_of_id IS NULL
         AND doc.superseded_by_id IS NULL
         AND doc.document_url IS NOT NULL
         AND (${options.institutionId ?? null}::bigint IS NULL OR doc.institution_id = ${options.institutionId ?? null}::bigint)
    ),
    ranked AS (
      SELECT current_copies.*,
             first_value(id) OVER (PARTITION BY institution_id, page ORDER BY crawled_at DESC NULLS LAST, id DESC) AS newest_id
        FROM current_copies
       WHERE page IS NOT NULL
    )
    SELECT id AS older_id, newest_id AS current_id
      FROM ranked
     WHERE id <> newest_id
     ORDER BY institution_id, id
     LIMIT ${options.limit ?? SAME_PAGE_COPY_LIMIT}
  `;
  const pairs = rows.map((row) => ({ olderDocumentId: Number(row.older_id), currentDocumentId: Number(row.current_id) }));
  if (pairs.length === 0) return empty;
  if (live) {
    await db`
      UPDATE source_documents older
         SET superseded_by_id = pair.current_id
        FROM unnest(${pairs.map((pair) => pair.olderDocumentId)}::bigint[], ${pairs.map((pair) => pair.currentDocumentId)}::bigint[])
             AS pair(older_id, current_id)
       WHERE older.id = pair.older_id
         AND older.superseded_by_id IS NULL
    `;
  }
  await db`
    INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, 'magellan.same_page_copies', 'completed',
      ${`${live ? "Superseded" : "Would supersede (shadow)"} ${pairs.length} current cop(ies) by a newer copy of the same page under another spelling`},
      ${JSON.stringify({ live, pairs: pairs.map((pair) => ({ older_document_id: pair.olderDocumentId, current_document_id: pair.currentDocumentId })) })}::jsonb
    )
  `;
  return { live, copies: pairs.length, pairs };
}
