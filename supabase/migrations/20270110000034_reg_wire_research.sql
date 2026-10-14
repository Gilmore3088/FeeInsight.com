-- Regulatory Wire research notes (stage 2): one note per wire item, written by Magellan's
-- registry-wire-research step from the item's own page text. A note holds a short AI summary
-- of that text, the type of action, a comment deadline and an effective date (each kept only
-- when the source text states it), one sentence of interpretation, and the source's URL and
-- text hash. The news page labels the summary as AI-written and the sentence as interpretation.
--
-- Keyed to the wire item: item_kind 'article' with item_id = reg_articles.guid (federal
-- releases and state regulator posts), or item_kind 'tracker' with item_id =
-- reg_tracker_items source || ':' || external_id (bills).
--
-- Additive only: one new empty table. No existing row changes value. The step writes rows
-- only when REG_WIRE_SUMMARIES_LIVE=true; until then it runs in shadow mode (picks items,
-- reads their pages, records what it would summarise in its run ledger, no model call).

BEGIN;

CREATE TABLE IF NOT EXISTS public.reg_wire_research (
  item_kind text NOT NULL CHECK (item_kind IN ('article', 'tracker')),
  item_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'source_unreadable', 'skipped')),
  reason text,
  summary text,
  action_type text CHECK (action_type IS NULL OR action_type IN (
    'proposed_rule', 'final_rule', 'guidance', 'enforcement', 'approval_ma',
    'comment_period_change', 'bill_action', 'other'
  )),
  comment_deadline date,
  effective_date date,
  why_it_matters text,
  dockets text[] NOT NULL DEFAULT '{}',
  source_url text NOT NULL,
  source_hash text,
  source_chars integer,
  model text,
  agent_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);
COMMENT ON TABLE public.reg_wire_research IS
  'Regulatory Wire research notes, one per wire item (registry-wire-research). summary and why_it_matters are AI-written from the source text; comment_deadline and effective_date are kept only when the source text states them.';

CREATE INDEX IF NOT EXISTS idx_reg_wire_research_created ON public.reg_wire_research (created_at DESC);

ALTER TABLE public.reg_wire_research ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reg_wire_research FROM PUBLIC, anon, authenticated;

COMMIT;
