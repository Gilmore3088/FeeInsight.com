-- Tracked-link visits and each lead's first tracked source (growth-os BUILD-PLAN 1.10, 1.11).
--
-- marketing_touches: one row per browser session that lands on the site from a link with
-- utm_ tags (LinkedIn posts, MailerLite emails). No personal data: no IP address, no user
-- agent, no cookie or visitor id. Only the link's UTM values, the path it landed on and the
-- referring site's host name. Written by POST /api/track/touch; read by the weekly scoring.
--
-- leads.first_utm_*: the UTM values of the first tracked link the visitor arrived on in the
-- session that sent the form. Set once (first touch wins) by /api/leads; never overwritten.
--
-- Data change: none. Creates one empty table and adds five nullable columns with no default
-- to leads (no table rewrite); every existing lead keeps NULL in all five.

CREATE TABLE IF NOT EXISTS public.marketing_touches (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  referrer_host text
);

CREATE INDEX IF NOT EXISTS marketing_touches_created_idx ON public.marketing_touches (created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_touches_campaign_idx ON public.marketing_touches (utm_campaign, created_at DESC);

ALTER TABLE public.marketing_touches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_utm_source text,
  ADD COLUMN IF NOT EXISTS first_utm_medium text,
  ADD COLUMN IF NOT EXISTS first_utm_campaign text,
  ADD COLUMN IF NOT EXISTS first_utm_content text,
  ADD COLUMN IF NOT EXISTS first_landing_path text;
