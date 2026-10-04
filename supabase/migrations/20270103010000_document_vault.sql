-- Document vault and fee-page check (Phase 1, PR 1c).
--
--   * source_documents records where our copy of each document lives in R2
--     (content-addressed key), its content type and size, so Rosetta reads the stored
--     copy and every fee can link to the exact file it came from.
--   * agent_source_texts gains the 'wrong_document' status: Rosetta read the page,
--     but it is not a fee schedule, so Knox skips it.
--   * institution_source_profiles.rejected_source_urls remembers URLs that turned out
--     not to be fee schedules, so Magellan discovery never proposes them again.
--
-- Additive and idempotent. The app probes for these columns before using them.

BEGIN;

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS document_r2_key  TEXT,
  ADD COLUMN IF NOT EXISTS content_type     TEXT,
  ADD COLUMN IF NOT EXISTS byte_size        BIGINT;

CREATE INDEX IF NOT EXISTS source_documents_r2_key_idx
  ON public.source_documents (document_r2_key)
  WHERE document_r2_key IS NOT NULL;

COMMENT ON COLUMN public.source_documents.document_r2_key IS
  'Content-addressed R2 key (<2 hex>/<sha256>) of our stored copy; see src/lib/agents/document-vault.ts.';

ALTER TABLE public.agent_source_texts
  DROP CONSTRAINT IF EXISTS agent_source_texts_status_check;
ALTER TABLE public.agent_source_texts
  ADD CONSTRAINT agent_source_texts_status_check
  CHECK (status IN ('completed', 'empty', 'needs_ocr', 'failed', 'skipped', 'wrong_document'));

ALTER TABLE public.institution_source_profiles
  ADD COLUMN IF NOT EXISTS rejected_source_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.institution_source_profiles.rejected_source_urls IS
  'JSON array of {url, reason, at}: pages that were read and found not to be fee schedules.';

COMMIT;
