-- One current document per page.
--
-- Magellan stores a new source_documents row whenever a page's content changes, so one
-- page (institution_id, document_url) collects many copies: 18,374 rows on 8,233 pages
-- on 2026-10-06, of which 3,205 are older successful copies.
--
--   * superseded_by_id: set on an older successful copy; points at the page's current
--     copy. Current copy = status 'success' AND duplicate_of_id IS NULL AND
--     superseded_by_id IS NULL. Magellan's fetch keeps it up to date from now on.
--   * The backfilled current copy is the one fetched or confirmed most recently.
--   * Failed fetches are left alone (history), and duplicates keep duplicate_of_id.
--
-- Data: this marks rows only. Nothing is deleted or re-pointed; fees, texts and attempts
-- keep the document id they cite, so no live fee loses its source link. Clearing the
-- column undoes it. Idempotent: a re-run marks nothing new.

SET lock_timeout = '10s';
SET statement_timeout = '300s';

BEGIN;

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS superseded_by_id BIGINT
    REFERENCES public.source_documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.source_documents.superseded_by_id IS
  'Set on an older successful copy of the same page (institution_id, document_url); points at the current copy. NULL on the current copy.';

WITH ranked AS (
  SELECT doc.id,
         first_value(doc.id) OVER (
           PARTITION BY doc.institution_id, doc.document_url
           ORDER BY GREATEST(doc.last_checked_at, doc.crawled_at) DESC NULLS LAST, doc.id DESC
         ) AS current_id
    FROM public.source_documents doc
   WHERE doc.status = 'success'
     AND doc.duplicate_of_id IS NULL
     AND doc.document_url IS NOT NULL
)
UPDATE public.source_documents doc
   SET superseded_by_id = ranked.current_id
  FROM ranked
 WHERE ranked.id = doc.id
   AND ranked.current_id <> doc.id
   AND doc.superseded_by_id IS DISTINCT FROM ranked.current_id;

CREATE INDEX IF NOT EXISTS source_documents_current_page_idx
  ON public.source_documents (institution_id, document_url)
  WHERE status = 'success'
    AND duplicate_of_id IS NULL
    AND superseded_by_id IS NULL;

COMMIT;
