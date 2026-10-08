-- The free-to-paid journey for founder-led outreach (James, 15:39 UTC Oct 8: "instrument the
-- free-to-paid journey"; use first-party page events and CRM outcomes, not email opens).
--
-- snapshot_events: what a visitor does on an institution's free market snapshot
-- (/institution/<id>/market): opened it, opened a source schedule, looked at another fee or a
-- competitor, clicked to request a report. No personal data: no IP address, no user agent, no
-- cookie or visitor id. Only the institution, the event, a short detail (a fee key) and the
-- link's UTM campaign and content (which outreach draft the visit came from). Written by
-- POST /api/track/snapshot.
--
-- outreach_outcomes: what happened after an email James sent, recorded by James or an admin in
-- /admin/growth: sent, replied, conversation, report requested, proposal, bought the report,
-- bought Pro, declined (with the reason in the buyer's words). One row per step, so the
-- journey keeps its order and dates.
--
-- Data change: none. Creates two empty tables with RLS on.

CREATE TABLE IF NOT EXISTS public.snapshot_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  institution_id bigint NOT NULL,
  event text NOT NULL CHECK (event IN ('opened', 'source_click', 'fee_view', 'competitor_click', 'report_click')),
  detail text,
  utm_campaign text,
  utm_content text
);

CREATE INDEX IF NOT EXISTS snapshot_events_institution_idx ON public.snapshot_events (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS snapshot_events_campaign_idx ON public.snapshot_events (utm_campaign, created_at DESC);

ALTER TABLE public.snapshot_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.outreach_outcomes (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  draft_id bigint,
  institution_id bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'sent', 'replied', 'conversation', 'report_requested', 'proposal',
    'purchased_report', 'purchased_pro', 'declined'
  )),
  note text,
  recorded_by text
);

CREATE INDEX IF NOT EXISTS outreach_outcomes_institution_idx ON public.outreach_outcomes (institution_id, created_at);
CREATE INDEX IF NOT EXISTS outreach_outcomes_draft_idx ON public.outreach_outcomes (draft_id);

ALTER TABLE public.outreach_outcomes ENABLE ROW LEVEL SECURITY;
