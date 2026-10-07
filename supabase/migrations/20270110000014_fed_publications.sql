-- Publications of the 12 regional Federal Reserve Banks (research, regional reports,
-- speeches), one row per item, pulled daily by Magellan's registry-fed-publications step
-- from the Reserve Banks' RSS feeds (public data, like fed_beige_book). Hamilton and the
-- regulation tracker read it for district-level context.
--
-- Additive only: one new empty table. No existing row changes value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fed_publications (
  link text PRIMARY KEY,
  district smallint NOT NULL CHECK (district BETWEEN 1 AND 12),
  bank text NOT NULL,
  title text NOT NULL,
  published_at timestamptz,
  feed_url text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fed_publications_district_published_idx
  ON public.fed_publications (district, published_at DESC);
COMMENT ON TABLE public.fed_publications IS
  'Regional Federal Reserve Bank publications by district, from the Fed in Print per-bank RSS feeds (fedinprint.org/rss) or a bank''s own feed.';

ALTER TABLE public.fed_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fed_publications FROM PUBLIC, anon, authenticated;

COMMIT;
