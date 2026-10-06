-- Companion fee pages: a bank's fees spread over several pages.
--
-- Small banks and credit unions often publish fees on each account's page (Freedom
-- Checking, Value Checking) or in separate PDFs (courtesy pay policy) instead of one fee
-- schedule. Magellan's companion finder (discover.second_document, version 2) stores
-- those pages in institution_additional_sources, and its companion fetch downloads each
-- one as its own source document. The bank's main fee link is never replaced.
--
--   * institution_additional_sources: new role account_page, the
--     account the page belongs to (account_name), and fetch state.
--   * source_documents.companion_source_id: which companion page a document came from.
--     NULL is the bank's main fee link. Rosetta reads the newest document of each
--     stream, and a companion page never replaces the main document or another page.
--
-- DDL only: adds nullable columns and widens a check. Changes no existing row.
-- Code checks information_schema before using the new columns.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

BEGIN;

ALTER TABLE public.institution_additional_sources
  DROP CONSTRAINT IF EXISTS institution_additional_sources_role_check;
ALTER TABLE public.institution_additional_sources
  ADD CONSTRAINT institution_additional_sources_role_check
  CHECK (document_role IN ('business', 'other_services', 'consumer_supplement', 'account_page'));

ALTER TABLE public.institution_additional_sources
  ADD COLUMN IF NOT EXISTS account_name TEXT,
  ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_source_document_id BIGINT,
  ADD COLUMN IF NOT EXISTS fetch_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_fetch_error TEXT;

COMMENT ON COLUMN public.institution_additional_sources.account_name IS
  'The account an account_page belongs to, from its link label (e.g. "Freedom Checking"); the label of other documents.';
COMMENT ON COLUMN public.institution_additional_sources.last_source_document_id IS
  'The source_documents row of the latest fetch of this page.';

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS companion_source_id BIGINT
  REFERENCES public.institution_additional_sources(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.source_documents.companion_source_id IS
  'The companion page (institution_additional_sources) this document was fetched from; NULL for the bank''s main fee link.';

CREATE INDEX IF NOT EXISTS source_documents_companion_source_idx
  ON public.source_documents (companion_source_id, id DESC)
  WHERE companion_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS institution_additional_sources_fetch_idx
  ON public.institution_additional_sources (status, last_fetched_at NULLS FIRST);

COMMIT;
