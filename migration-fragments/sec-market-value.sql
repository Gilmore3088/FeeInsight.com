-- sec-market-value (Magellan registry source 'sec-market-value',
-- src/lib/agents/magellan/registry/sec-market-value.ts; read by
-- src/lib/data-store/sec-market-value-aggregates.ts).
--
-- One row per SEC filer (CIK), dei concept and as-of date: dei:EntityPublicFloat (USD, as of the
-- last business day of the filer's second fiscal quarter) and dei:EntityCommonStockSharesOutstanding
-- (shares, as of each 10-K / 10-Q cover date), from data.sec.gov company facts, for bank holding
-- companies already linked by the sec-links step. When several filings repeat a date, the most
-- recently filed value is kept. Values are as filed; nothing is filled, defaulted or derived.
--
-- Why a new table: sec_fee_income_facts is keyed (cik, concept, frame) with frame NOT NULL, and
-- its reader getFeeIncomeFactMedians groups every concept in it as a fee-income line; cover-page
-- dei facts often carry no SEC frame, so storing them there would need an invented frame and would
-- surface market values as fee lines. area_statistics is for geographic areas, not filers.
--
-- Additive and idempotent: one new empty table and an index. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.sec_market_value_facts (
  id BIGSERIAL PRIMARY KEY,
  cik TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- 'dei:EntityPublicFloat' | 'dei:EntityCommonStockSharesOutstanding'
  concept TEXT NOT NULL,
  -- SEC's own label and description for the concept, from the same response.
  label TEXT,
  description TEXT,
  -- 'USD' | 'shares'
  unit TEXT NOT NULL,
  period_end DATE NOT NULL,
  value NUMERIC NOT NULL,
  fiscal_year INT,
  fiscal_period TEXT,
  -- SEC's calendar frame when the fact has one (e.g. CY2025Q2I); NULL otherwise, never invented.
  frame TEXT,
  accession_no TEXT,
  form TEXT,
  filed DATE,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cik, concept, period_end)
);

CREATE INDEX IF NOT EXISTS sec_market_value_facts_institution_idx
  ON public.sec_market_value_facts (institution_id, concept, period_end DESC);

ALTER TABLE public.sec_market_value_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sec_market_value_facts FROM PUBLIC, anon, authenticated;
