-- institution_payment_features: whether an institution offers a payment service, read from the
-- institution's own documents (#1875, part of #1783). The first feature is Zelle.
--
-- Written by the registry step `registry-bank-zelle` (src/lib/agents/magellan/registry/bank-zelle.ts).
-- It reads the current copy of each document the pipeline already stores (source_documents and
-- agent_source_texts) with deterministic text rules (bank-zelle-match.ts) and fetches nothing.
-- Nothing comes from Zelle's participant list: it was struck on 2026-10-17 (#1840) because its
-- terms allow only personal, non-commercial use.
--
-- One row per institution and feature:
--   status        offers | does_not_offer | unclear (documents disagree, or only mention Zelle,
--                 for example in a scam warning). An institution whose documents never name the
--                 service has no row: silence is not "does not offer".
--   evidence_url  the institution's own document the evidence sentence was read from (never null).
--   evidence_snippet  that sentence as the document states it (at most 300 characters).
--   rule          the text rule that decided the status ("conflict" or "mention" for unclear).
--   matcher_version  BANK_ZELLE_MATCHER_VERSION of the rules that wrote the row.
--
-- Schema only: creates one empty table, its indexes and RLS (enabled with no policies, so only the
-- service role reads or writes it). Changes no existing data. Nothing is back-filled here: the
-- registry step fills the table in batches of 300 institutions per run, at most one run an hour.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.institution_payment_features (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  status TEXT NOT NULL,
  rule TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL,
  -- The document and text the evidence was read from. Plain ids, no foreign keys: a key would lock
  -- source_documents and agent_source_texts, which the pipeline writes all day, while it is added.
  source_document_id BIGINT,
  agent_source_text_id BIGINT,
  documents_mentioning INTEGER NOT NULL DEFAULT 0,
  offers_sentences INTEGER NOT NULL DEFAULT 0,
  does_not_offer_sentences INTEGER NOT NULL DEFAULT 0,
  mention_sentences INTEGER NOT NULL DEFAULT 0,
  matcher_version INTEGER NOT NULL,
  agent_run_id BIGINT,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_payment_features_feature_check CHECK (feature IN ('zelle')),
  CONSTRAINT institution_payment_features_status_check CHECK (status IN ('offers', 'does_not_offer', 'unclear')),
  CONSTRAINT institution_payment_features_snippet_check CHECK (char_length(evidence_snippet) BETWEEN 1 AND 300),
  UNIQUE (institution_id, feature)
);

CREATE INDEX IF NOT EXISTS institution_payment_features_feature_status_idx
  ON public.institution_payment_features (feature, status);

ALTER TABLE public.institution_payment_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_payment_features FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.institution_payment_features IS
  'Whether an institution offers a payment service (Zelle first), read from its own stored documents by registry-bank-zelle (#1875). Never from Zelle''s participant list (struck 2026-10-17, #1840). evidence_url is the institution''s own document.';
