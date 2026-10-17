-- institution_designations: published designation lists that become peer filters, loaded by
-- Magellan's registry step `registry-designation-lists` (src/lib/agents/magellan/registry/designation-lists.ts).
--
-- One row per list row and designation. `source` is the list (one registry partition each):
--   fdic-institution-flags  FDIC BankFind institutions: minority_depository (MDI_STATUS_*),
--                           fdic_specialty_group (SPECGRP/SPECGRPN), ownership_form (MUTUAL:
--                           mutual|stock), subchapter_s (SUBCHAPS)
--   ncua-foicu-flags        FOICU.txt in the newest NCUA 5300 zip: low_income (LIMITED_INC),
--                           field_of_membership (TOM_CODE as filed), year_chartered (YEAR_OPENED)
--   ncua-mdi                NCUA's minority depository institution list: minority_depository
--   cdfi-fund               CDFI Fund certified CDFIs (bank, thrift, credit union, holding company
--                           types only): cdfi
--   bank-on                 Bank On certified accounts (joinbankon.org): bank_on_certified
-- `value` is the listed value (MDI group, specialty group name, FOM code, year, mutual/stock) or
-- 'yes' for a flag. Matching: FDIC cert or NCUA charter when the list carries one, else exact
-- normalized name + state. Unmatched rows are kept with institution_id NULL and
-- unmatched_reason set; each run lists them in registry_ingest_partitions.detail.cleaning.
-- `raw` keeps the source fields of the row, so a mapping fix needs no re-fetch.
-- A run replaces its list's rows (rows the list no longer carries are deleted), unless the new
-- read is under half the stored rows, which is reported and the old rows kept.
--
-- Additive: creates one empty table and its indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_designations (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  designation TEXT NOT NULL,
  value TEXT NOT NULL,
  -- Stable key within the list: FDIC cert, NCUA charter, or normalized name|state.
  record_key TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  listed_name TEXT,
  listed_state TEXT,
  listed_city TEXT,
  listed_cert TEXT,
  listed_charter TEXT,
  -- Organization type as the list states it (CDFI list); null otherwise.
  org_type TEXT,
  -- fdic_cert | ncua_charter | name_state; null when unmatched.
  matched_by TEXT,
  -- key_not_found | name_state_not_found | ambiguous_name_state | no_state | holding_company.
  unmatched_reason TEXT,
  -- Date the list speaks for: 5300 quarter end, a date in the file name, or the fetch date
  -- (the partition detail's as_of_basis says which).
  as_of DATE,
  source_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_designations_source_check
    CHECK (source IN ('fdic-institution-flags', 'ncua-foicu-flags', 'ncua-mdi', 'cdfi-fund', 'bank-on')),
  CONSTRAINT institution_designations_matched_by_check
    CHECK (matched_by IS NULL OR matched_by IN ('fdic_cert', 'ncua_charter', 'name_state')),
  UNIQUE (source, designation, record_key)
);

CREATE INDEX IF NOT EXISTS institution_designations_designation_institution_idx
  ON public.institution_designations (designation, institution_id)
  WHERE institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS institution_designations_institution_idx
  ON public.institution_designations (institution_id)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.institution_designations ENABLE ROW LEVEL SECURITY;
