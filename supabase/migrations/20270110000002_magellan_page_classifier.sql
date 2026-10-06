-- Magellan's learned fee-page classifier (MG-4). The discover step retrains it from the
-- outcome ledger (pipeline_feedback, check magellan.link_yield) when the newest row is
-- older than six hours, and stores one row per training: the weights, the label counts
-- and its score on held-out pages next to the rule check. Written only by
-- src/lib/agents/magellan/page-classifier.ts. It runs in shadow: it changes no decision.
--
-- Data: creates an empty table and an index; changes no existing rows.

CREATE TABLE IF NOT EXISTS public.magellan_page_classifier (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version       INTEGER NOT NULL,
  trained_at    TIMESTAMPTZ NOT NULL,
  agent_run_id  BIGINT,
  positives     INTEGER NOT NULL,
  negatives     INTEGER NOT NULL,
  model         JSONB NOT NULL,
  holdout       JSONB,
  mode          TEXT NOT NULL DEFAULT 'shadow',
  CONSTRAINT magellan_page_classifier_mode_check CHECK (mode IN ('shadow', 'deciding'))
);

CREATE INDEX IF NOT EXISTS magellan_page_classifier_version_idx
  ON public.magellan_page_classifier (version, trained_at DESC);

ALTER TABLE public.magellan_page_classifier ENABLE ROW LEVEL SECURITY;
