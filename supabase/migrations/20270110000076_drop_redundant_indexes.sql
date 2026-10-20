-- Drop eleven indexes that another valid index on the same table already covers, either as an
-- exact duplicate or as its leading columns (DB review LOW-2). Waits for James's yes before merge.
-- Index DDL only: no row is inserted, updated or deleted. None of these backs a constraint, and
-- the covering index (named per line) stays. Re-checked read-only against prod on 2026-10-20.
-- Undo: the CREATE INDEX statements are in the PR body.

SET lock_timeout = '5s';

-- Exact duplicates of a unique key.
DROP INDEX IF EXISTS public.idx_fed_indicators_series;
-- covered by fed_economic_indicators_series_id_observation_date_key (series_id, observation_date)
DROP INDEX IF EXISTS public.institution_analysis_results_institution_type_idx;
-- covered by institution_analysis_results_institution_type_key (institution_id, analysis_type)
DROP INDEX IF EXISTS public.idx_research_articles_slug;
-- covered by research_articles_slug_key (slug)
DROP INDEX IF EXISTS public.idx_articles_slug;
-- covered by articles_slug_key (slug)

-- Leading-column prefixes of a wider index.
DROP INDEX IF EXISTS public.institution_branch_deposits_cert_year_idx;
-- covered by institution_branch_deposits_cert_year_branch_number_key (cert, year, branch_number)
DROP INDEX IF EXISTS public.institution_financial_records_institution_report_idx;
-- covered by institution_financial_records_institution_report_source_key
--   (institution_id, report_date, source)
DROP INDEX IF EXISTS public.historical_fee_observation_archive_institution_review_idx;
-- covered by historical_fee_observation_archive_institution_status_idx
--   (institution_id, review_status, fee_category, amount)
DROP INDEX IF EXISTS public.idx_hamilton_refresh_jobs_signal;
-- covered by hamilton_refresh_jobs_source_signal_id_job_type_key (source_signal_id, job_type)
DROP INDEX IF EXISTS public.institution_complaint_records_institution_idx;
-- covered by institution_complaint_records_inst_period_product_issue_key
--   (institution_id, report_period, product, issue)
DROP INDEX IF EXISTS public.institution_network_memberships_network_asof_idx;
-- covered by institution_network_memberships_network_as_of_listed_key_key
--   (network, as_of, listed_key)
DROP INDEX IF EXISTS public.nic_relationships_parent_idx;
-- covered by nic_relationships_key (parent_rssd, offspring_rssd, start_date)
