-- Magellan find team: second fee documents for thin banks.
--
--   * institution_additional_sources: a bank's other fee documents (business fee
--     schedule, "other services" / miscellaneous fee list) found by the second-document
--     finder (discover.second_document) for live banks with fewer than 5 published fee
--     categories. Never replaces institution_sources.fee_schedule_url; downstream
--     fetch/read of these documents is separate work.
--
-- Additive and idempotent. Code checks to_regclass before using the new table.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.institution_additional_sources (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  document_type TEXT,
  document_role TEXT NOT NULL DEFAULT 'consumer_supplement',
  status TEXT NOT NULL DEFAULT 'found',
  found_by_strategy TEXT NOT NULL,
  strategy_version INTEGER NOT NULL DEFAULT 1,
  agent_run_id BIGINT,
  reason TEXT,
  found_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_additional_sources_role_check
    CHECK (document_role IN ('business', 'other_services', 'consumer_supplement')),
  CONSTRAINT institution_additional_sources_status_check
    CHECK (status IN ('found', 'fetched', 'rejected')),
  CONSTRAINT institution_additional_sources_unique UNIQUE (institution_id, url)
);

COMMENT ON TABLE public.institution_additional_sources IS
  'Other fee documents of a bank (business, other services) found by Magellan discover.second_document; the main fee link stays on institution_sources.';

CREATE INDEX IF NOT EXISTS institution_additional_sources_status_idx
  ON public.institution_additional_sources (status, found_at);

ALTER TABLE public.institution_additional_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_additional_sources FROM anon, authenticated;

