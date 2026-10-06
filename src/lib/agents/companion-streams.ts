import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * Companion fee pages (migration 20270109000000). A bank can publish its fees over
 * several pages: one page per checking account, a courtesy pay PDF, an "additional
 * services" list. Magellan's companion finder stores each page in
 * `institution_additional_sources`, and the companion fetch downloads it as a source
 * document with `companion_source_id` set.
 *
 * Each page is its own document stream: the main fee link is the stream with a NULL
 * `companion_source_id`, and every companion page is a stream of its own. Rosetta reads
 * the newest document of each stream, a rejected companion page never sends the bank's
 * main link back to discovery, and Hamilton never lets a fee from one stream replace a
 * live fee from another (Freedom Checking's monthly fee does not overwrite Value
 * Checking's).
 */

const readyCache = new WeakMap<object, boolean>();

/** True once the companion-pages migration is applied (positive answer cached). */
export async function companionStreamsReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`
    SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'source_documents' AND column_name = 'companion_source_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'institution_additional_sources' AND column_name = 'account_name'
      )
    ) AS companion_ready
  `;
  const ready = row?.companion_ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}

/** The companion page a source document was fetched from; null for the main fee link (or before the migration). */
export async function companionSourceOf(db: SqlTag, sourceDocumentId: number | null | undefined): Promise<number | null> {
  if (sourceDocumentId == null || !(await companionStreamsReady(db))) return null;
  const [row] = await db`SELECT companion_source_id FROM source_documents WHERE id = ${sourceDocumentId}`;
  return row?.companion_source_id == null ? null : Number(row.companion_source_id);
}

/**
 * Reason prefix for companion pages retired because today's finder rules say they are
 * not a consumer fee page (a HELOC disclosure, a business account). Hamilton takes down
 * live fees read from such pages (`hamilton/companion-retire.ts`); pages retired for
 * other reasons (a dead link, an empty page) keep the fees they already gave.
 */
export const NOT_CONSUMER_FEE_PAGE_REASON = "not_consumer_fee_page";

/**
 * A companion page Rosetta ruled out (not a fee page, or a dead link) is retired. The
 * bank's main fee link and its discovery state are left alone.
 */
export async function rejectCompanionPage(db: SqlTag, companionSourceId: number, reason: string): Promise<void> {
  await db`
    UPDATE institution_additional_sources
       SET status = 'rejected', reason = ${reason}, updated_at = NOW()
     WHERE id = ${companionSourceId}
  `;
}
