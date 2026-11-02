-- Where each page of a PDF starts in its stored text, so a fee citation can name the page.
--
-- James chose "Yes, add it" on 2026-11-02 12:44 UTC (Hamilton thread decision card: "Add a page-start
-- column to stored document text so fee citations can name the page?"). The stored text joins a PDF's
-- pages with a blank line and keeps no page break, so citations (locateFeeInText in
-- src/lib/source-location.ts, #2919) name a page for about 7 of 200 sampled live fees, only where the
-- document prints its own page numbers.
--
-- page_starts[i] is the code-point offset in normalized_text where page i+1 starts (page 1 at 0),
-- strictly increasing. Rosetta writes it with the text on every read (a separate PR); NULL means not
-- recorded (every existing row, HTML and other non-PDF texts). Rows fill on re-read; there is no
-- backfill.
--
-- Data: schema only. Adds one nullable column with no default, a catalog-only change in Postgres; no
-- row is rewritten and no fee, source or run data changes. agent_source_texts is a busy source table,
-- so lock_timeout makes the ALTER fail fast rather than queue reads behind it (migration-lock-kill).
-- Re-running is safe (IF NOT EXISTS).

SET lock_timeout = '10s';

ALTER TABLE public.agent_source_texts ADD COLUMN IF NOT EXISTS page_starts integer[];

COMMENT ON COLUMN public.agent_source_texts.page_starts IS
  'Code-point offsets in normalized_text where each PDF page starts (page 1 at 0), strictly increasing; written by Rosetta with the text; NULL when not recorded.';
