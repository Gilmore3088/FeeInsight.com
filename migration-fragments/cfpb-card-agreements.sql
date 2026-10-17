-- cfpb-card-agreements: CFPB Credit Card Agreement Database (quarterly zip of issuers' agreement
-- PDFs), Prepaid Product Agreements Database (metadata snapshot each quarter) and the Terms of
-- Credit Card Plans survey (twice-yearly CSV). Loaded by the Magellan registry step
-- src/lib/agents/magellan/registry/cfpb-card-agreements.ts; read by
-- src/lib/data-store/cfpb-card-agreements-aggregates.ts.
--
-- cfpb_card_agreements: one row per agreement file (credit_card), prepaid agreement (prepaid) or
-- survey plan (tccp_plan) per period ('2026Q2' or '2026H1'). institution_id is set only when the
-- issuer name matched exactly one institution_sources row by exact or normalized name; otherwise
-- NULL. raw_json keeps the source record (zip path or CSV row) so a mapping fix needs no re-fetch.
-- fee_status: read | no_text (scan or unreadable PDF) | fetch_failed | pending (not reached yet).
--
-- cfpb_agreement_terms: one row per labelled fee (or the TCCP purchase APR) per agreement: the quoted
-- line, and its amount only when the line is unambiguous (dollars and percentages in separate
-- columns; ambiguous = true leaves both NULL). Additive only; changes no existing data.

CREATE TABLE IF NOT EXISTS public.cfpb_card_agreements (
  id BIGSERIAL PRIMARY KEY,
  agreement_kind TEXT NOT NULL CHECK (agreement_kind IN ('credit_card', 'prepaid', 'tccp_plan')),
  period TEXT NOT NULL,
  period_date DATE NOT NULL,
  record_key TEXT NOT NULL,
  issuer_name TEXT,
  product_name TEXT,
  file_name TEXT,
  agreement_url TEXT,
  external_id TEXT,
  agreement_status TEXT,
  effective_date_text TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  file_sha256 TEXT,
  file_bytes BIGINT,
  fee_status TEXT NOT NULL CHECK (fee_status IN ('read', 'no_text', 'fetch_failed', 'pending')),
  fee_parser_version INTEGER NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT NOT NULL,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_kind, period, record_key)
);

CREATE INDEX IF NOT EXISTS cfpb_card_agreements_kind_period_idx
  ON public.cfpb_card_agreements (agreement_kind, period_date DESC);
CREATE INDEX IF NOT EXISTS cfpb_card_agreements_institution_idx
  ON public.cfpb_card_agreements (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cfpb_card_agreements_pending_idx
  ON public.cfpb_card_agreements (agreement_kind, period) WHERE fee_status = 'pending';

ALTER TABLE public.cfpb_card_agreements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cfpb_agreement_terms (
  id BIGSERIAL PRIMARY KEY,
  agreement_id BIGINT NOT NULL REFERENCES public.cfpb_card_agreements(id) ON DELETE CASCADE,
  term_type TEXT NOT NULL,
  quoted_text TEXT NOT NULL,
  amount_usd NUMERIC CHECK (amount_usd IS NULL OR amount_usd >= 0),
  amount_percent NUMERIC CHECK (amount_percent IS NULL OR amount_percent >= 0),
  amount_qualifier TEXT CHECK (amount_qualifier IS NULL OR amount_qualifier IN ('exact', 'up_to', 'none')),
  ambiguous BOOLEAN NOT NULL DEFAULT false,
  ambiguity_reason TEXT,
  line_count INTEGER NOT NULL DEFAULT 1,
  parser_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_id, term_type),
  CHECK (amount_usd IS NULL OR amount_percent IS NULL)
);

CREATE INDEX IF NOT EXISTS cfpb_agreement_terms_type_idx
  ON public.cfpb_agreement_terms (term_type) WHERE NOT ambiguous;

ALTER TABLE public.cfpb_agreement_terms ENABLE ROW LEVEL SECURITY;
