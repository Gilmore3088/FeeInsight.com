-- Two tables for public regulator data that Magellan's registry does not load yet.
--
-- 1. institution_call_report_items: one row per institution, quarter and call-report line,
--    for detail lines beyond the fixed columns of institution_financial_records. Banks come
--    from the FFIEC bulk call report (MDRM codes such as RIADH033 maintenance charges,
--    RCONF049 deposit accounts of $250,000 or less, RCFD1406 loans 30-89 days past due,
--    RIAD4635 charge-offs). Credit unions come from the NCUA 5300 archive (ACCT_* codes).
--    Each row keeps the regulator's own description of the line, read from the file, so a
--    code is never labelled from memory. A line missing from a file is reported in the
--    registry run (registry_ingest_partitions.detail), never written as zero or guessed.
--    Long format, so adding a line later needs no migration.
--
-- 2. institution_structure_events: FDIC BankFind structure history (mergers, charter and
--    name changes, failures, branch openings and closings), one row per FDIC event record.
--
-- Additive: creates two empty tables and their indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_call_report_items (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  -- 'ffiec' (bank call report, FFIEC 031/041/051) or 'ncua' (5300).
  source TEXT NOT NULL,
  report_date DATE NOT NULL,
  -- The code exactly as the file's column header carries it (RIADH033, RCFD1406, ACCT_564A).
  item_code TEXT NOT NULL,
  -- Our name for the line (maintenance_charges_ytd, past_due_30_89, ...).
  item_key TEXT NOT NULL,
  -- The regulator's description from the same file (FFIEC header row 2, NCUA AcctDesc).
  item_description TEXT,
  -- Schedule or table the line came from (RI, RIBI, RCN, RCO, FS220A ...).
  schedule TEXT,
  value NUMERIC NOT NULL,
  -- thousands (FFIEC dollar lines), dollars (NCUA dollar lines), count.
  unit TEXT NOT NULL,
  -- ytd (income statement), point_in_time (balance sheet and counts).
  period_basis TEXT NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_call_report_items_source_check CHECK (source IN ('ffiec', 'ncua')),
  CONSTRAINT institution_call_report_items_unit_check CHECK (unit IN ('thousands', 'dollars', 'count')),
  CONSTRAINT institution_call_report_items_basis_check CHECK (period_basis IN ('ytd', 'point_in_time')),
  UNIQUE (institution_id, source, report_date, item_key)
);

CREATE INDEX IF NOT EXISTS institution_call_report_items_key_date_idx
  ON public.institution_call_report_items (item_key, report_date);

CREATE INDEX IF NOT EXISTS institution_call_report_items_source_date_idx
  ON public.institution_call_report_items (source, report_date);

ALTER TABLE public.institution_call_report_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.institution_structure_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'fdic-history',
  -- The FDIC record's own id when it has one, else a hash of the record.
  event_key TEXT NOT NULL,
  cert TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  institution_name TEXT,
  change_code TEXT,
  change_description TEXT,
  effective_date DATE,
  process_date DATE,
  acquirer_cert TEXT,
  acquirer_name TEXT,
  outgoing_cert TEXT,
  outgoing_name TEXT,
  survivor_cert TEXT,
  survivor_name TEXT,
  -- Branch events: the office the event is about.
  office_number TEXT,
  office_name TEXT,
  office_city TEXT,
  office_state TEXT,
  office_zip TEXT,
  office_county TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, event_key)
);

CREATE INDEX IF NOT EXISTS institution_structure_events_institution_idx
  ON public.institution_structure_events (institution_id, effective_date);

CREATE INDEX IF NOT EXISTS institution_structure_events_cert_idx
  ON public.institution_structure_events (cert, effective_date);

CREATE INDEX IF NOT EXISTS institution_structure_events_code_date_idx
  ON public.institution_structure_events (change_code, effective_date);

ALTER TABLE public.institution_structure_events ENABLE ROW LEVEL SECURITY;
