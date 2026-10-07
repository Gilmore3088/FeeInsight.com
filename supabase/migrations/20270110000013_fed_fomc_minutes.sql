-- Full text of the Federal Open Market Committee's minutes, one row per meeting, pulled
-- by Magellan's registry-fomc-minutes step from federalreserve.gov (public data, like
-- fed_beige_book). Hamilton and the regulation tracker read it for monetary policy context.
--
-- Additive only: one new empty table. No existing row changes value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fed_fomc_minutes (
  meeting_date date PRIMARY KEY,
  title text,
  content_text text NOT NULL,
  source_url text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.fed_fomc_minutes IS
  'FOMC minutes text by meeting date (the last day of the meeting), from federalreserve.gov/monetarypolicy/fomcminutesYYYYMMDD.htm.';

ALTER TABLE public.fed_fomc_minutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fed_fomc_minutes FROM PUBLIC, anon, authenticated;

COMMIT;
