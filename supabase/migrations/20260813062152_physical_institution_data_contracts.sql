-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Convert remaining institution-keyed semantic contracts from compatibility
-- views into physical tables and remove empty retired crawler-era tables.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

DROP VIEW IF EXISTS public.agent_institution_run_results;
DROP VIEW IF EXISTS public.institution_fee_alert_subscriptions;
DROP VIEW IF EXISTS public.institution_analysis_results;
DROP VIEW IF EXISTS public.institution_fee_snapshot_records;
DROP VIEW IF EXISTS public.fee_change_records;
DROP VIEW IF EXISTS public.institution_branch_deposits;
DROP VIEW IF EXISTS public.institution_complaint_records;
DROP VIEW IF EXISTS public.institution_financial_records;

-- Preserve the read shape formerly provided by fee_change_records.
ALTER TABLE public.fee_change_events
  DROP COLUMN IF EXISTS institution_id,
  ADD COLUMN IF NOT EXISTS changed_at timestamptz;

UPDATE public.fee_change_events
SET old_amount = previous_amount::numeric
WHERE old_amount IS NULL
  AND previous_amount IS NOT NULL;

UPDATE public.fee_change_events
SET changed_at = detected_at
WHERE changed_at IS NULL;

-- Preserve the read shape formerly provided by institution_fee_alert_subscriptions.
ALTER TABLE public.fee_alert_subscriptions
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;

ALTER TABLE public.institution_financials RENAME TO institution_financial_records;
ALTER TABLE public.institution_complaints RENAME TO institution_complaint_records;
ALTER TABLE public.branch_deposits RENAME TO institution_branch_deposits;
ALTER TABLE public.fee_change_events RENAME TO fee_change_records;
ALTER TABLE public.fee_snapshots RENAME TO institution_fee_snapshot_records;
ALTER TABLE public.analysis_results RENAME TO institution_analysis_results;
ALTER TABLE public.fee_alert_subscriptions RENAME TO institution_fee_alert_subscriptions;
ALTER TABLE public.agent_run_results RENAME TO agent_institution_run_results;

ALTER TABLE public.institution_financial_records
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.institution_complaint_records
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.institution_branch_deposits
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.fee_change_records
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.institution_fee_snapshot_records
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.institution_fee_snapshot_records
  RENAME COLUMN crawl_result_id TO source_document_id;
ALTER TABLE public.institution_analysis_results
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.institution_fee_alert_subscriptions
  RENAME COLUMN crawl_target_id TO institution_id;
ALTER TABLE public.agent_institution_run_results
  RENAME COLUMN crawl_target_id TO institution_id;

ALTER TABLE public.institution_financial_records
  RENAME CONSTRAINT institution_financials_pkey TO institution_financial_records_pkey;
ALTER TABLE public.institution_financial_records
  RENAME CONSTRAINT institution_financials_crawl_target_id_fkey TO institution_financial_records_institution_id_fkey;
ALTER TABLE public.institution_financial_records
  RENAME CONSTRAINT institution_financials_crawl_target_id_report_date_source_key
  TO institution_financial_records_institution_report_source_key;

ALTER TABLE public.institution_complaint_records
  RENAME CONSTRAINT institution_complaints_pkey TO institution_complaint_records_pkey;
ALTER TABLE public.institution_complaint_records
  RENAME CONSTRAINT institution_complaints_crawl_target_id_fkey TO institution_complaint_records_institution_id_fkey;
ALTER TABLE public.institution_complaint_records
  RENAME CONSTRAINT institution_complaints_crawl_target_id_report_period_produc_key
  TO institution_complaint_records_inst_period_product_issue_key;

ALTER TABLE public.institution_branch_deposits
  RENAME CONSTRAINT branch_deposits_pkey TO institution_branch_deposits_pkey;
ALTER TABLE public.institution_branch_deposits
  RENAME CONSTRAINT branch_deposits_crawl_target_id_fkey TO institution_branch_deposits_institution_id_fkey;
ALTER TABLE public.institution_branch_deposits
  RENAME CONSTRAINT branch_deposits_cert_year_branch_number_key
  TO institution_branch_deposits_cert_year_branch_number_key;

ALTER TABLE public.fee_change_records
  RENAME CONSTRAINT fee_change_events_pkey TO fee_change_records_pkey;
ALTER TABLE public.fee_change_records
  RENAME CONSTRAINT fee_change_events_crawl_target_id_fkey TO fee_change_records_institution_id_fkey;

ALTER TABLE public.institution_fee_snapshot_records
  RENAME CONSTRAINT fee_snapshots_pkey TO institution_fee_snapshot_records_pkey;
ALTER TABLE public.institution_fee_snapshot_records
  RENAME CONSTRAINT fee_snapshots_crawl_target_id_fkey TO institution_fee_snapshot_records_institution_id_fkey;
ALTER TABLE public.institution_fee_snapshot_records
  RENAME CONSTRAINT fee_snapshots_crawl_result_id_fkey TO institution_fee_snapshot_records_source_document_id_fkey;
ALTER TABLE public.institution_fee_snapshot_records
  RENAME CONSTRAINT fee_snapshots_crawl_target_id_snapshot_date_fee_category_key
  TO institution_fee_snapshot_records_institution_date_category_key;

ALTER TABLE public.institution_analysis_results
  RENAME CONSTRAINT analysis_results_pkey TO institution_analysis_results_pkey;
ALTER TABLE public.institution_analysis_results
  RENAME CONSTRAINT analysis_results_crawl_target_id_fkey TO institution_analysis_results_institution_id_fkey;
ALTER TABLE public.institution_analysis_results
  RENAME CONSTRAINT analysis_results_crawl_target_id_analysis_type_key
  TO institution_analysis_results_institution_type_key;

ALTER TABLE public.institution_fee_alert_subscriptions
  RENAME CONSTRAINT fee_alert_subscriptions_pkey TO institution_fee_alert_subscriptions_pkey;
ALTER TABLE public.institution_fee_alert_subscriptions
  RENAME CONSTRAINT fee_alert_subscriptions_crawl_target_id_fkey TO institution_fee_alert_subscriptions_institution_id_fkey;
ALTER TABLE public.institution_fee_alert_subscriptions
  RENAME CONSTRAINT fee_alert_subscriptions_user_id_fkey TO institution_fee_alert_subscriptions_user_id_fkey;
ALTER TABLE public.institution_fee_alert_subscriptions
  RENAME CONSTRAINT fee_alert_subscriptions_user_id_crawl_target_id_key
  TO institution_fee_alert_subscriptions_user_institution_key;

ALTER TABLE public.agent_institution_run_results
  RENAME CONSTRAINT agent_run_results_pkey TO agent_institution_run_results_pkey;
ALTER TABLE public.agent_institution_run_results
  RENAME CONSTRAINT agent_run_results_agent_run_id_fkey TO agent_institution_run_results_agent_run_id_fkey;

ALTER SEQUENCE IF EXISTS public.institution_financials_id_seq RENAME TO institution_financial_records_id_seq;
ALTER SEQUENCE IF EXISTS public.institution_complaints_id_seq RENAME TO institution_complaint_records_id_seq;
ALTER SEQUENCE IF EXISTS public.branch_deposits_id_seq RENAME TO institution_branch_deposits_id_seq;
ALTER SEQUENCE IF EXISTS public.fee_change_events_id_seq RENAME TO fee_change_records_id_seq;
ALTER SEQUENCE IF EXISTS public.fee_snapshots_id_seq RENAME TO institution_fee_snapshot_records_id_seq;
ALTER SEQUENCE IF EXISTS public.analysis_results_id_seq RENAME TO institution_analysis_results_id_seq;
ALTER SEQUENCE IF EXISTS public.fee_alert_subscriptions_id_seq RENAME TO institution_fee_alert_subscriptions_id_seq;
ALTER SEQUENCE IF EXISTS public.agent_run_results_id_seq RENAME TO agent_institution_run_results_id_seq;

ALTER SEQUENCE IF EXISTS public.institution_financial_records_id_seq OWNED BY public.institution_financial_records.id;
ALTER SEQUENCE IF EXISTS public.institution_complaint_records_id_seq OWNED BY public.institution_complaint_records.id;
ALTER SEQUENCE IF EXISTS public.institution_branch_deposits_id_seq OWNED BY public.institution_branch_deposits.id;
ALTER SEQUENCE IF EXISTS public.fee_change_records_id_seq OWNED BY public.fee_change_records.id;
ALTER SEQUENCE IF EXISTS public.institution_fee_snapshot_records_id_seq OWNED BY public.institution_fee_snapshot_records.id;
ALTER SEQUENCE IF EXISTS public.institution_analysis_results_id_seq OWNED BY public.institution_analysis_results.id;
ALTER SEQUENCE IF EXISTS public.institution_fee_alert_subscriptions_id_seq OWNED BY public.institution_fee_alert_subscriptions.id;
ALTER SEQUENCE IF EXISTS public.agent_institution_run_results_id_seq OWNED BY public.agent_institution_run_results.id;

ALTER INDEX IF EXISTS public.idx_financials_cert RENAME TO institution_financial_records_cert_idx;
ALTER INDEX IF EXISTS public.idx_financials_date_source RENAME TO institution_financial_records_report_source_idx;
ALTER INDEX IF EXISTS public.idx_financials_target_date RENAME TO institution_financial_records_institution_report_idx;
ALTER INDEX IF EXISTS public.idx_financials_unmatched RENAME TO institution_financial_records_unmatched_source_idx;

ALTER INDEX IF EXISTS public.idx_complaints_target RENAME TO institution_complaint_records_institution_idx;

ALTER INDEX IF EXISTS public.idx_branch_deposits_cert RENAME TO institution_branch_deposits_cert_year_idx;
ALTER INDEX IF EXISTS public.idx_branch_deposits_msa RENAME TO institution_branch_deposits_msa_year_idx;

ALTER INDEX IF EXISTS public.idx_fce_date_category RENAME TO fee_change_records_detected_category_idx;

ALTER INDEX IF EXISTS public.idx_snapshots_target_cat RENAME TO institution_fee_snapshot_records_institution_category_idx;

ALTER INDEX IF EXISTS public.idx_analysis_target_type RENAME TO institution_analysis_results_institution_type_idx;

ALTER INDEX IF EXISTS public.idx_alert_subs_user RENAME TO institution_fee_alert_subscriptions_user_active_idx;

ALTER INDEX IF EXISTS public.idx_agent_run_results_run RENAME TO agent_institution_run_results_run_idx;

DROP TABLE IF EXISTS public.crawl_target_changes;
DROP TABLE IF EXISTS public.upload_jobs;

ALTER TABLE public.institution_financial_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_complaint_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_branch_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_change_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_fee_snapshot_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_fee_alert_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_institution_run_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.institution_financial_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.institution_complaint_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.institution_branch_deposits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fee_change_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.institution_fee_snapshot_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.institution_analysis_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.institution_fee_alert_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_institution_run_results FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.institution_financial_records_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.institution_complaint_records_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.institution_branch_deposits_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fee_change_records_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.institution_fee_snapshot_records_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.institution_analysis_results_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.institution_fee_alert_subscriptions_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.agent_institution_run_results_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_institution_fee_alert_subscription(
  p_user_id BIGINT,
  p_institution_id BIGINT,
  p_fee_categories TEXT[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  subscription_id BIGINT;
BEGIN
  INSERT INTO public.institution_fee_alert_subscriptions (user_id, institution_id, fee_categories)
  VALUES (p_user_id, p_institution_id, p_fee_categories)
  ON CONFLICT (user_id, institution_id) DO UPDATE
  SET is_active = TRUE,
      fee_categories = EXCLUDED.fee_categories
  RETURNING id INTO subscription_id;

  RETURN subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_institution_fee_alert_subscription(
  p_user_id BIGINT,
  p_institution_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE public.institution_fee_alert_subscriptions
  SET is_active = FALSE
  WHERE user_id = p_user_id
    AND institution_id = p_institution_id;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_institution_fee_alert_subscription(BIGINT, BIGINT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_institution_fee_alert_subscription(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.institution_financial_records IS
  'Physical institution financial records keyed by institution_id.';
COMMENT ON TABLE public.institution_complaint_records IS
  'Physical institution complaint records keyed by institution_id.';
COMMENT ON TABLE public.institution_branch_deposits IS
  'Physical institution branch deposit records keyed by institution_id.';
COMMENT ON TABLE public.fee_change_records IS
  'Physical fee-change records keyed by institution_id.';
COMMENT ON TABLE public.institution_fee_snapshot_records IS
  'Physical historical fee snapshot records keyed by institution_id and source_document_id.';
COMMENT ON TABLE public.institution_analysis_results IS
  'Physical institution analysis results keyed by institution_id.';
COMMENT ON TABLE public.institution_fee_alert_subscriptions IS
  'Physical fee alert subscriptions keyed by institution_id.';
COMMENT ON TABLE public.agent_institution_run_results IS
  'Physical state-agent institution run result records keyed by institution_id.';

COMMENT ON COLUMN public.institution_financial_records.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.institution_complaint_records.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.institution_branch_deposits.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.fee_change_records.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.institution_fee_snapshot_records.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.institution_fee_snapshot_records.source_document_id IS
  'Semantic source document identifier for the snapshot lineage.';
COMMENT ON COLUMN public.institution_analysis_results.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.institution_fee_alert_subscriptions.institution_id IS
  'Semantic institution/source identifier.';
COMMENT ON COLUMN public.agent_institution_run_results.institution_id IS
  'Semantic institution/source identifier.';

$migration$;
END
$legacy_guard$;
