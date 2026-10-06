-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Migration: Enable Row-Level Security on all public tables
-- Triggered by: Supabase security alert (rls_disabled_in_public)
--
-- Context: The app connects via direct postgres (DATABASE_URL) which uses the
-- postgres role and bypasses RLS entirely. This migration protects against
-- unauthorized access via the Supabase REST API (PostgREST), which uses the
-- anon/authenticated roles.
--
-- Policy: DENY ALL via PostgREST. Only the Edge Function (fee-lookup) uses
-- the Supabase client, and it uses SERVICE_ROLE_KEY which bypasses RLS.
--
-- Safe to apply: enabling RLS with no permissive policies means PostgREST
-- returns zero rows for anon/authenticated roles. Direct postgres connections
-- are unaffected.

ALTER TABLE agent_run_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE beige_book_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE census_tracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_target_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE demographics ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE fed_beige_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE fed_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE fed_economic_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_alert_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_index_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_standard_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hamilton_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hamilton_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_concentration ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reg_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE roomba_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_peer_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_subscriber_peer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

$migration$;
END
$legacy_guard$;
