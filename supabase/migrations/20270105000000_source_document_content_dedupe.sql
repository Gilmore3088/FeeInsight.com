-- One stored document per (institution, content).
--
-- Magellan used to insert a new source_documents row on every fetch, so the same bytes
-- sit under many ids (12,135 rows, 5,771 distinct hashes on 2026-09-30). Fetch now
-- reuses the existing document when the content matches one it already has.
--
--   * duplicate_of_id: points a duplicate at the document that represents its content.
--     Nothing is deleted or re-pointed; texts, raw fees and attempts that reference a
--     duplicate keep their lineage. Clearing the column undoes the mark.
--   * The representative is the copy Rosetta read (a completed text), else the oldest.
--   * A unique partial index then enforces one live document per content.
--
-- Additive and idempotent: re-running marks nothing new and the index already exists.

SET lock_timeout = '10s';
SET statement_timeout = '300s';

BEGIN;

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS duplicate_of_id BIGINT
    REFERENCES public.source_documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.source_documents.duplicate_of_id IS
  'Set when another successful document of the same institution holds the same content_hash; points at that representative document.';

WITH ranked AS (
  SELECT doc.id,
         first_value(doc.id) OVER (
           PARTITION BY doc.institution_id, doc.content_hash
           ORDER BY (
             EXISTS (
               SELECT 1 FROM public.agent_source_texts adt
                WHERE adt.source_document_id = doc.id AND adt.status = 'completed'
             )
           ) DESC,
           doc.id ASC
         ) AS representative_id
    FROM public.source_documents doc
   WHERE doc.status = 'success'
     AND doc.content_hash IS NOT NULL
     AND doc.duplicate_of_id IS NULL
)
UPDATE public.source_documents doc
   SET duplicate_of_id = ranked.representative_id
  FROM ranked
 WHERE ranked.id = doc.id
   AND ranked.representative_id <> doc.id;

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_institution_content_unique_idx
  ON public.source_documents (institution_id, content_hash)
  WHERE status = 'success'
    AND content_hash IS NOT NULL
    AND duplicate_of_id IS NULL;

COMMENT ON INDEX public.source_documents_institution_content_unique_idx IS
  'One live successful document per institution and content hash; duplicates carry duplicate_of_id.';

COMMIT;
