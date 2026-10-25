-- A schedule's own date, kept apart from when it was read (#1878; James approved Oct 25).
--
-- source_documents records when Magellan fetched a page (crawled_at, last_checked_at) and the
-- server's Last-Modified header (last_modified), never the date the document itself states. A
-- fee PDF named "...-2022.pdf" fetched yesterday looked current. These three columns hold the
-- date the document states, read from its stored text by Magellan's stated-date pass
-- (src/lib/agents/magellan/stated-date.ts):
--   * stated_date: the latest date its opening text states (effective, revised or "as of"), else,
--     only when the text states no date, the year its address names (stored as 1 January); NULL
--     when it states none or is not read yet.
--   * stated_date_basis: where that date came from.
--   * stated_date_version: the reader version that set them; NULL means not read yet.
--
-- Data: none. Columns only, all nullable with no default, so every existing row stays as it is
-- (NULL) and the CHECK holds for all of them. No backfill: the Magellan pass fills them in its
-- own runs, visible in agent_run_events (magellan.stated_dates). The pass and the freshness
-- search check for these columns and leave them alone until they exist.
-- Undo: ALTER TABLE public.source_documents DROP COLUMN stated_date_version,
--   DROP COLUMN stated_date_basis, DROP COLUMN stated_date;

SET lock_timeout = '10s';

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS stated_date date,
  ADD COLUMN IF NOT EXISTS stated_date_basis text
    CHECK (stated_date_basis IN ('effective_statement', 'printed_date', 'url_year', 'none')),
  ADD COLUMN IF NOT EXISTS stated_date_version integer;

COMMENT ON COLUMN public.source_documents.stated_date IS
  'The date the document states (latest effective, revised or "as of" date in its opening text, else, only when the text states no date, the year its address names as 1 January); NULL when none or not read. Not the fetch date.';
COMMENT ON COLUMN public.source_documents.stated_date_basis IS
  'Where stated_date came from: effective_statement, printed_date, url_year or none.';
COMMENT ON COLUMN public.source_documents.stated_date_version IS
  'STATED_DATE_VERSION of the Magellan reader that set stated_date (magellan/stated-date.ts); NULL means not read yet.';
