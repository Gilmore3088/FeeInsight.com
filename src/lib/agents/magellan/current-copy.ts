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
 * none, and exact-address superseding goes on as before. Live since a shadow review on prod
 * (5 fetch steps, 7 Oct 2026): the same 109 pairs every step, each a true respelling (www,
 * :443, http, trailing slash, #fragment), no thin current copy, 277 live fees on the older
 * copies. Superseding moves no fee by itself: Hamilton's refresh moves a live fee to the
 * current copy only when the current copy reads the same line, and its newer-copy check
 * still pairs exact addresses, so no fee comes down because a spelling changed.
 */
export const SAME_PAGE_SUPERSEDE_LIVE = true;
/** Older same-page copies marked (or, in shadow mode, logged) per fetch step. */
export const SAME_PAGE_COPY_LIMIT = 200;

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

export interface SamePageCopyResult {
  live: boolean;
  /** Current copies another, newer spelling of their page supersedes (or would). */
  copies: number;
  pairs: Array<{ olderDocumentId: number; currentDocumentId: number }>;
}

/**
 * Backfill for pages stored under two spellings: of each institution's current copies that
 * name the same page, the newest stays current and the others point at it, as a fetch of
 * that page now does. A thin copy (bot check, script shell) never takes the place of a
 * readable one, as in `restoreReadableCopies`. In shadow mode (SAME_PAGE_SUPERSEDE_LIVE false) it only logs the pairs.
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
             EXISTS (
               SELECT 1 FROM agent_source_texts thin
                WHERE thin.source_document_id = doc.id
                  AND thin.status <> 'completed'
                  AND COALESCE(thin.char_count, 0) < ${THIN_COPY_MAX_CHARS}
                  AND thin.source_hash = doc.content_hash
             ) AS thin,
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
             first_value(id) OVER (PARTITION BY institution_id, page ORDER BY thin, crawled_at DESC NULLS LAST, id DESC) AS newest_id
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

export interface MovedHandFoundCopyResult {
  /** Older hand-found copies now pointed at the copy of the bank's current hand-found link. */
  copies: number;
  pairs: Array<{ olderDocumentId: number; currentDocumentId: number }>;
}

/**
 * A bank's hand-found schedule that moved to a new address. When OPERATOR_SCHEDULES swaps a
 * bank's link for the same file at a new path on the same host (Regions, 9 Oct 2026:
 * `/virtualDocuments/Checking-Pricing-Schedule.pdf` became
 * `/-/media/pdfs/pricing-schedules/Checking-Pricing-Schedule.pdf`), the old link's copy stayed
 * current beside the new one: 34 of Regions' live fees still cited the stale copy, and Darwin
 * compared every new row against it. Here the old link's current copy points at the new
 * link's current copy, as a newer copy of one page does, so Hamilton's refresh moves the
 * fees the new copy restates and its current-copy check looks at the rest.
 *
 * Only hand-found links (`discover.operator_schedule`) of the same institution, the same host
 * and the same file name pair, and only when the new link is the bank's current one and its
 * copy has a readable text. Nothing is deleted and no fee is touched here.
 */
export async function supersedeMovedHandFoundCopies(
  db: SqlTag,
  options: {
    runId: number;
    strategy: string;
    links: ReadonlyArray<{ institutionId: number; url: string }>;
    institutionId?: number | null;
  },
): Promise<MovedHandFoundCopyResult> {
  const empty: MovedHandFoundCopyResult = { copies: 0, pairs: [] };
  const links = options.links.filter((link) => options.institutionId == null || link.institutionId === options.institutionId);
  if (links.length === 0) return empty;
  if (!(await currentCopySchemaReady(db))) return empty;
  const rows = await db<Array<{ older_id: number | string; current_id: number | string }>>`
    -- moved hand-found copies
    WITH links AS (
      SELECT * FROM unnest(${links.map((link) => link.institutionId)}::bigint[], ${links.map((link) => link.url)}::text[])
        AS l(institution_id, url)
    ),
    newest AS (
      SELECT DISTINCT ON (l.institution_id)
             l.institution_id, ias.id AS companion_id, cur.id AS current_id,
             substring(lower(ias.url) from ${PAGE_HOST_SQL}) AS host,
             lower(substring(split_part(split_part(ias.url, '#', 1), '?', 1) from '/([^/]+)/*$')) AS leaf
        FROM links l
        JOIN institution_additional_sources ias
          ON ias.institution_id = l.institution_id
         AND ias.url = l.url
         AND ias.found_by_strategy = ${options.strategy}
        JOIN source_documents cur
          ON cur.companion_source_id = ias.id
         AND cur.status = 'success'
         AND cur.duplicate_of_id IS NULL
         AND cur.superseded_by_id IS NULL
       WHERE EXISTS (
         SELECT 1 FROM agent_source_texts readable
          WHERE readable.source_document_id = cur.id
            AND readable.status = 'completed'
            AND readable.char_count >= ${THIN_COPY_MAX_CHARS}
       )
       ORDER BY l.institution_id, cur.crawled_at DESC NULLS LAST, cur.id DESC
    )
    SELECT older.id AS older_id, newest.current_id
      FROM newest
      JOIN institution_additional_sources old_link
        ON old_link.institution_id = newest.institution_id
       AND old_link.found_by_strategy = ${options.strategy}
       AND old_link.id <> newest.companion_id
       AND substring(lower(old_link.url) from ${PAGE_HOST_SQL}) = newest.host
       AND lower(substring(split_part(split_part(old_link.url, '#', 1), '?', 1) from '/([^/]+)/*$')) = newest.leaf
      JOIN source_documents older
        ON older.companion_source_id = old_link.id
       AND older.status = 'success'
       AND older.duplicate_of_id IS NULL
       AND older.superseded_by_id IS NULL
     WHERE newest.leaf IS NOT NULL
     ORDER BY older.id
  `;
  const pairs = rows.map((row) => ({ olderDocumentId: Number(row.older_id), currentDocumentId: Number(row.current_id) }));
  if (pairs.length === 0) return empty;
  await db`
    UPDATE source_documents older
       SET superseded_by_id = pair.current_id
      FROM unnest(${pairs.map((pair) => pair.olderDocumentId)}::bigint[], ${pairs.map((pair) => pair.currentDocumentId)}::bigint[])
           AS pair(older_id, current_id)
     WHERE older.id = pair.older_id
       AND older.superseded_by_id IS NULL
  `;
  await db`
    INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, 'magellan.moved_hand_found_copies', 'completed',
      ${`Superseded ${pairs.length} cop(ies) of a hand-found schedule that moved to a new address on the same site`},
      ${JSON.stringify({ pairs: pairs.map((pair) => ({ older_document_id: pair.olderDocumentId, current_document_id: pair.currentDocumentId })) })}::jsonb
    )
  `;
  return { copies: pairs.length, pairs };
}
