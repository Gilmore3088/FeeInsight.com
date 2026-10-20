-- Call-report quarterly income, precomputed once per load instead of on every page read
-- (James, 2026-10-20: keep the raw filings, stop recomputing quarterly aggregates per request).
-- Schema only: two new empty tables, their indexes and RLS. Changes no existing data.
-- Waits for James's yes before merge.
--
-- call_report_quarterly_income: one row per fdic/ncua filing in institution_financial_records
-- (record_id is that row's id). The ffiec rows are never copied (financial-sources.ts).
-- NCUA 5300 income is year-to-date; FDIC income is already quarterly. Two standalone-quarter
-- figures are stored, one per rule the readers used before this table existed, so every
-- published number stays the same:
--   quarter_income            the window rule: the filer's previous filing in the same calendar
--                             year (prior_report_day) 80-100 days earlier is subtracted; Q1 and
--                             FDIC rows stand alone; otherwise null.
--   prior_quarter_end_income  the exact rule: the filing dated the previous quarter end is
--                             subtracted; Q1 and FDIC rows stand alone; otherwise null.
-- Registry identity (charter, tier, district, state) is not copied: readers join
-- institution_sources at read time, so a registry change shows at once.
--
-- call_report_summary_groups: one row per (source, calendar year) with the count and a hash of
-- the filings the rows above were built from. Hoovie's registry-call-report-summaries step
-- rebuilds only the groups whose filings changed, in one transaction, and writes these rows in
-- that same transaction.
--
-- RLS on with no policies: service-role reads only, like the other registry tables.

CREATE TABLE IF NOT EXISTS public.call_report_quarterly_income (
  record_id BIGINT PRIMARY KEY,
  institution_id BIGINT,
  source TEXT NOT NULL,
  report_date TEXT NOT NULL,
  report_day DATE NOT NULL,
  report_year INTEGER NOT NULL,
  quarter_start DATE NOT NULL,
  filed_service_charge_income BIGINT,
  prior_report_day DATE,
  quarter_income BIGINT,
  prior_quarter_end_income BIGINT,
  total_assets BIGINT,
  total_deposits BIGINT,
  other_noninterest_income BIGINT,
  fee_income_ratio DOUBLE PRECISION,
  agent_run_id BIGINT,
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT call_report_quarterly_income_source_check CHECK (source IN ('fdic', 'ncua'))
);

CREATE INDEX IF NOT EXISTS call_report_quarterly_income_day_idx
  ON public.call_report_quarterly_income (report_day, source);
CREATE INDEX IF NOT EXISTS call_report_quarterly_income_date_idx
  ON public.call_report_quarterly_income (report_date, source);
CREATE INDEX IF NOT EXISTS call_report_quarterly_income_institution_idx
  ON public.call_report_quarterly_income (institution_id, report_date);
CREATE INDEX IF NOT EXISTS call_report_quarterly_income_group_idx
  ON public.call_report_quarterly_income (source, report_year);

CREATE TABLE IF NOT EXISTS public.call_report_summary_groups (
  source TEXT NOT NULL,
  report_year INTEGER NOT NULL,
  filing_count BIGINT NOT NULL,
  filings_hash NUMERIC NOT NULL,
  agent_run_id BIGINT,
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, report_year),
  CONSTRAINT call_report_summary_groups_source_check CHECK (source IN ('fdic', 'ncua'))
);

ALTER TABLE public.call_report_quarterly_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_report_summary_groups ENABLE ROW LEVEL SECURITY;
