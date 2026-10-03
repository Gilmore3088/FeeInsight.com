-- Regulatory registry: run-ledger-visible ingestion of published regulator data
-- (FDIC BankFind institutions + quarterly financials first; NCUA, SOD, CFPB,
-- SEC EDGAR, Beige Book, FRED and state regulators follow as their own steps).
--
-- 1. institution_financial_records gains the call-report lines the gated
--    Financial profile charts: earnings, credit quality, loan mix, funding,
--    capital, plus lineage (source_url, agent_run_id). Dollar columns follow the
--    existing fdic/ncua convention: thousands of dollars, quarterly (not YTD).
-- 2. institution_sources gains regulator identity and lifecycle columns so the
--    universe sync can record holding company, primary regulator, and
--    closures/mergers instead of leaving dead institutions in the fee pipeline.
-- 3. registry_ingest_partitions records one row per (source, partition) so the
--    scheduler can backfill history one partition at a time and refresh on a
--    cadence, and the admin view can show freshness and failures.
--
-- Additive and idempotent.

BEGIN;

ALTER TABLE public.institution_financial_records
  ADD COLUMN IF NOT EXISTS net_income BIGINT,
  ADD COLUMN IF NOT EXISTS net_interest_income BIGINT,
  ADD COLUMN IF NOT EXISTS noninterest_expense BIGINT,
  ADD COLUMN IF NOT EXISTS provision_for_losses BIGINT,
  ADD COLUMN IF NOT EXISTS net_charge_offs BIGINT,
  ADD COLUMN IF NOT EXISTS noncurrent_loans BIGINT,
  ADD COLUMN IF NOT EXISTS total_equity BIGINT,
  ADD COLUMN IF NOT EXISTS total_securities BIGINT,
  ADD COLUMN IF NOT EXISTS loans_real_estate BIGINT,
  ADD COLUMN IF NOT EXISTS loans_commercial BIGINT,
  ADD COLUMN IF NOT EXISTS loans_consumer BIGINT,
  ADD COLUMN IF NOT EXISTS loans_credit_card BIGINT,
  ADD COLUMN IF NOT EXISTS loans_auto BIGINT,
  ADD COLUMN IF NOT EXISTS loans_agricultural BIGINT,
  ADD COLUMN IF NOT EXISTS core_deposits BIGINT,
  ADD COLUMN IF NOT EXISTS brokered_deposits BIGINT,
  ADD COLUMN IF NOT EXISTS uninsured_deposits BIGINT,
  ADD COLUMN IF NOT EXISTS leverage_ratio DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS total_capital_ratio DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS net_charge_off_rate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS noncurrent_loan_rate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS agent_run_id BIGINT;

COMMENT ON COLUMN public.institution_financial_records.net_charge_off_rate IS
  'Annualized quarterly net charge-offs / average loans, percent (FDIC NTLNLSQR).';
COMMENT ON COLUMN public.institution_financial_records.agent_run_id IS
  'agent_runs.id of the registry run that last wrote this row.';

ALTER TABLE public.institution_sources
  ADD COLUMN IF NOT EXISTS holding_company_rssd TEXT,
  ADD COLUMN IF NOT EXISTS holding_company_name TEXT,
  ADD COLUMN IF NOT EXISTS primary_regulator TEXT,
  ADD COLUMN IF NOT EXISTS charter_agency TEXT,
  ADD COLUMN IF NOT EXISTS regulatory_status TEXT,
  ADD COLUMN IF NOT EXISTS closed_date DATE,
  ADD COLUMN IF NOT EXISTS registry_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'institution_sources_regulatory_status_check'
       AND conrelid = 'public.institution_sources'::regclass
  ) THEN
    ALTER TABLE public.institution_sources
      ADD CONSTRAINT institution_sources_regulatory_status_check
      CHECK (regulatory_status IS NULL OR regulatory_status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS institution_sources_holding_company_idx
  ON public.institution_sources (holding_company_rssd)
  WHERE holding_company_rssd IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.registry_ingest_partitions (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  attempts INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER,
  matched_count INTEGER,
  unmatched_count INTEGER,
  inserted_count INTEGER,
  source_url TEXT,
  agent_run_id BIGINT,
  last_error TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_attempt_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT registry_ingest_partitions_source_partition_key UNIQUE (source, partition_key),
  CONSTRAINT registry_ingest_partitions_status_check
    CHECK (status IN ('scheduled', 'succeeded', 'empty', 'failed'))
);

CREATE INDEX IF NOT EXISTS registry_ingest_partitions_due_idx
  ON public.registry_ingest_partitions (source, next_attempt_after);

ALTER TABLE public.registry_ingest_partitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_ingest_partitions FROM anon, authenticated;

COMMIT;
