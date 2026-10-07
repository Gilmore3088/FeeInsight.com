-- Production public schema snapshot (tables, constraints, views) taken 2026-10-04 from
-- the live database, plus the reference rows the pipeline needs. Used only by
-- src/lib/agents/pipeline.e2e.test.ts against a throwaway database.
-- Refresh it when a migration changes a table the pipeline reads or writes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SEQUENCE IF NOT EXISTS public.agent_institution_run_results_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.agent_lessons_lesson_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.agent_run_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.agent_run_steps_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.agent_runs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.agent_source_texts_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.ai_api_usage_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.alert_preferences_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.api_budget_policies_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.api_budget_windows_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.api_keys_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.api_rate_limit_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.api_route_audit_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.articles_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.automation_control_audit_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.beige_book_themes_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.census_tracts_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.classification_cache_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.classification_history_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.community_fee_submission_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.community_fee_submissions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.consumer_guide_revisions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.consumer_guide_sections_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.consumer_guides_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.coverage_snapshots_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.demographics_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.external_intelligence_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.fed_beige_book_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.fed_content_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.fed_economic_indicators_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.fee_change_records_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.fee_reviews_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.gold_standard_verifications_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.hamilton_digest_runs_run_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.hamilton_digest_subscriptions_subscription_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.historical_fee_observation_archive_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.holding_company_financials_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_analysis_results_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_branch_deposits_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_claim_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_claims_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_complaint_records_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_fee_alert_subscriptions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_fee_snapshot_records_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_filings_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_financial_records_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_identity_links_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_source_corrections_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_sources_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_workspace_invitations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.institution_workspace_memberships_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.jobs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.knox_overrides_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.leads_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.market_concentration_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.org_members_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.organizations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.pipeline_attempts_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.pipeline_runs_id_seq1;
CREATE SEQUENCE IF NOT EXISTS public.pipeline_steps_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.public_discovery_findings_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.public_discovery_observations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.published_fee_record_rollback_log_rollback_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.published_fee_records_fee_published_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.raw_fee_observations_fee_raw_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.registry_ingest_partitions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.research_articles_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.research_conversations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.research_messages_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.research_usage_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.roomba_log_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.saved_peer_sets_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.saved_subscriber_peer_groups_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.shadow_outputs_shadow_output_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.source_collection_runs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.source_documents_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.source_validation_queue_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.stripe_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.subscriptions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.usage_events_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.users_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.verified_fee_observations_fee_verified_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.wave_runs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.wave_state_runs_id_seq;
CREATE TABLE public.agent_auth_log (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_04 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_05 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_06 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_07 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_08 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_09 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_10 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_2026_11 (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_auth_log_default (  auth_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_event_id uuid NOT NULL,
  agent_name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  tool_name text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reasoning_hash bytea,
  parent_event_id uuid
);
CREATE TABLE public.agent_budgets (  agent_name text NOT NULL,
  budget_window text NOT NULL,
  limit_cents integer NOT NULL,
  spent_cents integer DEFAULT 0 NOT NULL,
  window_started_at timestamp with time zone DEFAULT now() NOT NULL,
  halted_at timestamp with time zone,
  halted_reason text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_events (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_04 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_05 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_06 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_07 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_08 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_09 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_10 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_2026_11 (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_events_default (  event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  action text NOT NULL,
  tool_name text,
  entity text,
  entity_id text,
  status text NOT NULL,
  cost_cents integer DEFAULT 0 NOT NULL,
  confidence numeric(5,4),
  parent_event_id uuid,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  reasoning_hash bytea,
  input_payload jsonb,
  output_payload jsonb,
  source_refs jsonb,
  error jsonb,
  is_shadow boolean DEFAULT false NOT NULL,
  reasoning_prompt_text text,
  reasoning_output_text text,
  reasoning_r2_key text
);
CREATE TABLE public.agent_health_rollup (  bucket_start timestamp with time zone NOT NULL,
  agent_name text NOT NULL,
  loop_completion_rate numeric(5,4),
  review_latency_seconds integer,
  pattern_promotion_rate numeric(5,4),
  confidence_drift numeric(6,4),
  cost_to_value_ratio numeric(10,4),
  events_total integer
);
CREATE TABLE public.agent_institution_run_results (  id integer DEFAULT nextval('agent_institution_run_results_id_seq'::regclass) NOT NULL,
  agent_run_id integer,
  institution_id integer NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  detail jsonb,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.agent_lessons (  lesson_id bigint DEFAULT nextval('agent_lessons_lesson_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_name text NOT NULL,
  lesson_name text NOT NULL,
  description text NOT NULL,
  evidence_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
  confidence numeric(5,4),
  superseded_by bigint,
  source_event_id uuid
);
CREATE TABLE public.agent_messages (  message_id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sender_agent text NOT NULL,
  recipient_agent text NOT NULL,
  intent text NOT NULL,
  state text DEFAULT 'open'::text NOT NULL,
  correlation_id uuid NOT NULL,
  parent_message_id uuid,
  parent_event_id uuid,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  round_number integer DEFAULT 1 NOT NULL,
  expires_at timestamp with time zone,
  resolved_at timestamp with time zone,
  resolved_by_event_id uuid,
  responded_at timestamp with time zone
);
CREATE TABLE public.agent_registry (  agent_name text NOT NULL,
  display_name text NOT NULL,
  description text,
  role text NOT NULL,
  parent_agent text,
  state_code text,
  is_active boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  lifecycle_state text DEFAULT 'q1_validation'::text NOT NULL,
  review_schedule text
);
CREATE TABLE public.agent_run_events (  id bigint DEFAULT nextval('agent_run_events_id_seq'::regclass) NOT NULL,
  agent_run_id integer NOT NULL,
  step_id bigint,
  event_type text NOT NULL,
  status text DEFAULT 'info'::text NOT NULL,
  message text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  cost_microusd bigint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_run_steps (  id bigint DEFAULT nextval('agent_run_steps_id_seq'::regclass) NOT NULL,
  agent_run_id integer NOT NULL,
  step_key text NOT NULL,
  agent_name text NOT NULL,
  title text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  sequence integer DEFAULT 0 NOT NULL,
  summary text,
  input_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  output_payload jsonb,
  error_summary text,
  queued_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_runs (  id integer DEFAULT nextval('agent_runs_id_seq'::regclass) NOT NULL,
  state_code text,
  status text DEFAULT 'running'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  total_institutions integer DEFAULT 0 NOT NULL,
  discovered integer DEFAULT 0 NOT NULL,
  classified integer DEFAULT 0 NOT NULL,
  extracted integer DEFAULT 0 NOT NULL,
  validated integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  current_stage text,
  current_institution text,
  pass_number integer DEFAULT 1,
  strategy text DEFAULT 'tier1'::text,
  agent_name text,
  run_kind text DEFAULT 'state_agent'::text NOT NULL,
  title text,
  summary text,
  params_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  trigger_source text DEFAULT 'admin'::text NOT NULL,
  triggered_by text,
  idempotency_key text,
  correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  backend text DEFAULT 'agentic_v1'::text NOT NULL,
  progress_current integer DEFAULT 0 NOT NULL,
  progress_total integer DEFAULT 0 NOT NULL,
  error_summary text,
  cancel_requested_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  budget_policy_id bigint,
  max_provider_calls integer,
  max_estimated_cost_microusd bigint,
  actual_provider_calls integer DEFAULT 0 NOT NULL,
  actual_estimated_cost_microusd bigint DEFAULT 0 NOT NULL
);
CREATE TABLE public.agent_source_texts (  id bigint DEFAULT nextval('agent_source_texts_id_seq'::regclass) NOT NULL,
  agent_run_id integer,
  source_document_id bigint NOT NULL,
  institution_id bigint NOT NULL,
  source_url text,
  document_type text,
  content_type text,
  source_hash text,
  status text DEFAULT 'completed'::text NOT NULL,
  normalized_text text,
  text_hash text,
  char_count integer DEFAULT 0 NOT NULL,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_state_lanes (  state_code text NOT NULL,
  priority_score integer DEFAULT 0 NOT NULL,
  freshness_target_hours integer DEFAULT 24 NOT NULL,
  backlog_missing_urls integer DEFAULT 0 NOT NULL,
  backlog_stale_sources integer DEFAULT 0 NOT NULL,
  backlog_ocr integer DEFAULT 0 NOT NULL,
  backlog_manual_review integer DEFAULT 0 NOT NULL,
  failure_count integer DEFAULT 0 NOT NULL,
  correction_count integer DEFAULT 0 NOT NULL,
  last_agent_run_id integer,
  last_run_at timestamp with time zone,
  last_success_at timestamp with time zone,
  next_run_after timestamp with time zone DEFAULT now() NOT NULL,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.agent_url_discovery_attempts (  institution_id bigint NOT NULL,
  discovery_method text NOT NULL,
  attempted_at timestamp with time zone DEFAULT now() NOT NULL,
  result text,
  found_url text,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.ai_api_usage_events (  id bigint DEFAULT nextval('ai_api_usage_events_id_seq'::regclass) NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  agent_name text NOT NULL,
  operation text NOT NULL,
  status text NOT NULL,
  request_count integer DEFAULT 1 NOT NULL,
  input_tokens bigint DEFAULT 0 NOT NULL,
  output_tokens bigint DEFAULT 0 NOT NULL,
  cache_read_input_tokens bigint DEFAULT 0 NOT NULL,
  cache_creation_input_tokens bigint DEFAULT 0 NOT NULL,
  estimated_cost_microusd bigint,
  latency_ms integer,
  error_summary text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_run_id integer,
  route_id text,
  budget_policy_id bigint,
  user_id integer,
  subject_key text
);
CREATE TABLE public.alert_preferences (  id bigint DEFAULT nextval('alert_preferences_id_seq'::regclass) NOT NULL,
  organization_id bigint NOT NULL,
  categories text,
  peer_group_id integer,
  frequency text DEFAULT 'weekly'::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.api_budget_policies (  id bigint DEFAULT nextval('api_budget_policies_id_seq'::regclass) NOT NULL,
  policy_key text NOT NULL,
  scope text NOT NULL,
  route_id text,
  agent_name text,
  enabled boolean DEFAULT false NOT NULL,
  hard_daily_microusd bigint,
  hard_monthly_microusd bigint,
  max_requests_per_window integer,
  window_seconds integer,
  max_provider_calls_per_window integer,
  max_provider_calls_per_run integer,
  max_provider_calls_per_tick integer,
  max_estimated_cost_per_run_microusd bigint,
  max_estimated_cost_per_tick_microusd bigint,
  fail_closed boolean DEFAULT true NOT NULL,
  notes text,
  created_by text DEFAULT 'migration'::text NOT NULL,
  updated_by text DEFAULT 'migration'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.api_budget_windows (  id bigint DEFAULT nextval('api_budget_windows_id_seq'::regclass) NOT NULL,
  policy_id bigint NOT NULL,
  window_key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  reserved_microusd bigint DEFAULT 0 NOT NULL,
  actual_microusd bigint DEFAULT 0 NOT NULL,
  request_count integer DEFAULT 0 NOT NULL,
  provider_call_count integer DEFAULT 0 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.api_keys (  id bigint DEFAULT nextval('api_keys_id_seq'::regclass) NOT NULL,
  organization_id bigint NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  name text DEFAULT 'Default'::text NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.api_rate_limit_events (  id bigint DEFAULT nextval('api_rate_limit_events_id_seq'::regclass) NOT NULL,
  route_id text NOT NULL,
  subject_type text NOT NULL,
  subject_key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  request_count integer DEFAULT 0 NOT NULL,
  limit_count integer NOT NULL,
  event_type text DEFAULT 'reservation'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.api_route_audit_events (  id bigint DEFAULT nextval('api_route_audit_events_id_seq'::regclass) NOT NULL,
  route_id text NOT NULL,
  method text NOT NULL,
  path text,
  surface text,
  status_code integer,
  outcome text NOT NULL,
  latency_ms integer,
  user_id integer,
  subject_key text,
  auth_policy text,
  rate_limit_policy text,
  cost_policy text,
  budget_policy_id bigint,
  provider text,
  model text,
  agent_name text,
  operation text,
  reason_code text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.articles (  id bigint DEFAULT nextval('articles_id_seq'::regclass) NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  article_type text,
  fee_category text,
  fed_district integer,
  status text DEFAULT 'draft'::text NOT NULL,
  review_tier integer DEFAULT 2 NOT NULL,
  content_md text NOT NULL,
  data_context text NOT NULL,
  summary text,
  model_id text,
  prompt_hash text,
  generated_at text NOT NULL,
  reviewed_by text,
  reviewed_at text,
  published_at text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  word_count integer,
  reading_time_min integer,
  data_snapshot_date text,
  quality_gate_results text,
  body text,
  author text,
  tags text[]
);
CREATE TABLE public.automation_control (  control_key text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  reason text,
  changed_by text DEFAULT 'system'::text NOT NULL,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  revision bigint DEFAULT 1 NOT NULL
);
CREATE TABLE public.automation_control_audit (  id bigint DEFAULT nextval('automation_control_audit_id_seq'::regclass) NOT NULL,
  action text NOT NULL,
  reason text,
  actor text NOT NULL,
  active_job_count integer DEFAULT 0 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.backup_institution_sources_names_20260815 (  id bigint,
  institution_name text
);
CREATE TABLE public.backup_published_fee_catalog_20260815 (  id bigint,
  fee_published_id bigint,
  fee_verified_id bigint,
  fee_raw_id bigint,
  institution_id integer,
  fee_name text,
  amount numeric(12,2),
  frequency text,
  conditions text,
  extraction_confidence numeric(5,4),
  review_status text,
  validation_flags jsonb,
  fee_category text,
  canonical_fee_key text,
  fee_family text,
  account_product_type text,
  is_fee_cap boolean,
  variant_type text,
  coverage_tier text,
  source_url text,
  source text,
  document_url text,
  document_r2_key text,
  source_document_id integer,
  agent_event_id uuid,
  verified_by_agent_event_id uuid,
  published_by_adversarial_event_id uuid,
  batch_id text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);
CREATE TABLE public.beige_book_themes (  id bigint DEFAULT nextval('beige_book_themes_id_seq'::regclass) NOT NULL,
  release_code text NOT NULL,
  fed_district integer NOT NULL,
  theme_category text NOT NULL,
  sentiment text NOT NULL,
  summary text NOT NULL,
  confidence double precision DEFAULT 0.0 NOT NULL,
  extracted_at timestamp with time zone DEFAULT now() NOT NULL,
  model_used text DEFAULT 'claude-haiku-4-5-20251001'::text NOT NULL,
  district text,
  period text,
  theme text,
  source_url text
);
CREATE TABLE public.canary_runs (  run_id uuid DEFAULT gen_random_uuid() NOT NULL,
  agent_name text NOT NULL,
  corpus_version text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  status text NOT NULL,
  is_baseline boolean DEFAULT false NOT NULL,
  coverage numeric(5,4),
  confidence_mean numeric(5,4),
  extraction_count integer,
  coverage_delta numeric(5,4),
  confidence_delta numeric(5,4),
  extraction_count_delta integer,
  verdict text,
  report_payload jsonb,
  baseline_run_id uuid
);
CREATE TABLE public.census_tracts (  id bigint DEFAULT nextval('census_tracts_id_seq'::regclass) NOT NULL,
  tract_id text NOT NULL,
  state_fips text NOT NULL,
  county_fips text NOT NULL,
  msa_code text,
  income_level text,
  median_family_income integer,
  tract_median_income integer,
  income_ratio double precision,
  population integer,
  minority_pct double precision,
  year integer NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.classification_cache (  normalized_name text,
  canonical_fee_key text,
  confidence double precision NOT NULL,
  model text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  cache_key text,
  source text,
  updated_at timestamp with time zone,
  id bigint DEFAULT nextval('classification_cache_id_seq'::regclass) NOT NULL
);
CREATE TABLE public.classification_history (  id bigint DEFAULT nextval('classification_history_id_seq'::regclass) NOT NULL,
  fee_verified_id bigint NOT NULL,
  old_canonical_key text,
  new_canonical_key text NOT NULL,
  old_variant_type text,
  new_variant_type text,
  agent_event_id uuid,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  changed_by text
);
CREATE TABLE public.community_fee_submission_events (  id bigint DEFAULT nextval('community_fee_submission_events_id_seq'::regclass) NOT NULL,
  submission_id bigint NOT NULL,
  actor_user_id integer,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.community_fee_submissions (  id bigint DEFAULT nextval('community_fee_submissions_id_seq'::regclass) NOT NULL,
  institution_id bigint,
  institution_name text NOT NULL,
  fee_name text NOT NULL,
  fee_category text,
  amount numeric,
  frequency text,
  source_url text NOT NULL,
  submitter_ip text,
  review_status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  submitter_role text,
  notes text,
  submission_kind text DEFAULT 'fee_row'::text NOT NULL,
  reviewed_at timestamp with time zone,
  reviewer_id integer,
  review_notes text,
  resolution text,
  source_document_id integer,
  agent_run_id integer
);
CREATE TABLE public.consumer_guide_revisions (  id bigint DEFAULT nextval('consumer_guide_revisions_id_seq'::regclass) NOT NULL,
  guide_id bigint NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  change_note text,
  agent_run_id integer,
  regulatory_approved_by text,
  regulatory_approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.consumer_guide_sections (  id bigint DEFAULT nextval('consumer_guide_sections_id_seq'::regclass) NOT NULL,
  guide_id bigint NOT NULL,
  anchor text NOT NULL,
  heading text NOT NULL,
  "position" integer NOT NULL,
  blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.consumer_guides (  id bigint DEFAULT nextval('consumer_guides_id_seq'::regclass) NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  seo_title text NOT NULL,
  description text NOT NULL,
  primary_category text NOT NULL,
  related_categories text[] DEFAULT '{}'::text[] NOT NULL,
  family text NOT NULL,
  audience text DEFAULT 'consumer'::text NOT NULL,
  access_tier text DEFAULT 'public'::text NOT NULL,
  featured boolean DEFAULT false NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  carries_regulatory_content boolean DEFAULT false NOT NULL,
  regulatory_approved_by text,
  regulatory_approved_at timestamp with time zone,
  author text DEFAULT 'Fee Insight Research'::text NOT NULL,
  reviewed_at timestamp with time zone,
  published_at timestamp with time zone,
  methodology_href text,
  related_slugs text[] DEFAULT '{}'::text[] NOT NULL,
  generated_by text,
  agent_run_id integer,
  stale_since timestamp with time zone,
  stale_reason text,
  view_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.coverage_snapshots (  id bigint DEFAULT nextval('coverage_snapshots_id_seq'::regclass) NOT NULL,
  snapshot_date text NOT NULL,
  total_institutions integer NOT NULL,
  with_fee_url integer NOT NULL,
  with_fees integer NOT NULL,
  with_approved integer NOT NULL,
  total_fees integer NOT NULL,
  approved_fees integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.demographics (  id bigint DEFAULT nextval('demographics_id_seq'::regclass) NOT NULL,
  geo_id text NOT NULL,
  geo_type text NOT NULL,
  geo_name text,
  state_fips text,
  county_fips text,
  median_household_income integer,
  poverty_count integer,
  total_population integer,
  year integer NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.external_intelligence (  id integer DEFAULT nextval('external_intelligence_id_seq'::regclass) NOT NULL,
  source_name text,
  source_date date NOT NULL,
  category text NOT NULL,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  content_text text NOT NULL,
  source_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text,
  search_vector tsvector,
  source text,
  series_id text,
  title text,
  body text,
  payload jsonb,
  observed_at timestamp with time zone
);
CREATE TABLE public.fed_beige_book (  id bigint DEFAULT nextval('fed_beige_book_id_seq'::regclass) NOT NULL,
  release_date text NOT NULL,
  release_code text NOT NULL,
  fed_district integer,
  section_name text NOT NULL,
  content_text text NOT NULL,
  source_url text NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.fed_content (  id bigint DEFAULT nextval('fed_content_id_seq'::regclass) NOT NULL,
  content_type text NOT NULL,
  title text NOT NULL,
  speaker text,
  fed_district integer,
  source_url text NOT NULL,
  published_at text NOT NULL,
  description text,
  source_feed text,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.fed_economic_indicators (  id bigint DEFAULT nextval('fed_economic_indicators_id_seq'::regclass) NOT NULL,
  series_id text NOT NULL,
  series_title text,
  fed_district integer,
  observation_date text NOT NULL,
  value double precision,
  units text,
  frequency text,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.fee_change_records (  id bigint DEFAULT nextval('fee_change_records_id_seq'::regclass) NOT NULL,
  institution_id bigint,
  fee_category text NOT NULL,
  previous_amount double precision,
  new_amount double precision,
  change_type text NOT NULL,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  canonical_fee_key text,
  old_amount numeric,
  changed_at timestamp with time zone
);
CREATE TABLE public.fee_index_cache (  fee_category text NOT NULL,
  fee_family text,
  median_amount double precision,
  p25_amount double precision,
  p75_amount double precision,
  min_amount double precision,
  max_amount double precision,
  institution_count integer DEFAULT 0 NOT NULL,
  observation_count integer DEFAULT 0 NOT NULL,
  approved_count integer DEFAULT 0 NOT NULL,
  bank_count integer DEFAULT 0 NOT NULL,
  cu_count integer DEFAULT 0 NOT NULL,
  maturity_tier text DEFAULT 'insufficient'::text NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  stats_method_version integer DEFAULT 1 NOT NULL,
  agent_run_id bigint
);
CREATE TABLE public.fee_reviews (  id bigint DEFAULT nextval('fee_reviews_id_seq'::regclass) NOT NULL,
  fee_id bigint NOT NULL,
  action text NOT NULL,
  user_id bigint,
  username text,
  previous_status text,
  new_status text,
  previous_values jsonb,
  new_values jsonb,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone
);
CREATE TABLE public.gold_standard_verifications (  id bigint DEFAULT nextval('gold_standard_verifications_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  fee_id bigint NOT NULL,
  verdict text NOT NULL,
  verified_by text NOT NULL,
  verified_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hamilton_conversations (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  title text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hamilton_digest_runs (  run_id bigint DEFAULT nextval('hamilton_digest_runs_run_id_seq'::regclass) NOT NULL,
  subscription_id bigint NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  status text DEFAULT 'pending'::text NOT NULL,
  response_text text,
  response_r2_key text,
  cost_cents integer DEFAULT 0 NOT NULL,
  error text
);
CREATE TABLE public.hamilton_digest_subscriptions (  subscription_id bigint DEFAULT nextval('hamilton_digest_subscriptions_subscription_id_seq'::regclass) NOT NULL,
  user_id bigint,
  label text NOT NULL,
  prompt text NOT NULL,
  cadence text NOT NULL,
  delivery text DEFAULT 'inbox'::text NOT NULL,
  delivery_address text,
  active boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  next_due_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hamilton_messages (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  token_count integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id text,
  tool_calls jsonb
);
CREATE TABLE public.hamilton_priority_alerts (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  signal_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  acknowledged_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  priority text
);
CREATE TABLE public.hamilton_refresh_job_completions (  job_id uuid NOT NULL,
  user_id integer NOT NULL,
  completed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hamilton_refresh_jobs (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id text NOT NULL,
  source_signal_id uuid,
  source_signal_type text,
  job_type text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  priority integer DEFAULT 1 NOT NULL,
  reason text NOT NULL,
  source_json jsonb,
  completed_by_user_id integer,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hamilton_reports (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  institution_id text NOT NULL,
  scenario_id uuid,
  report_type text NOT NULL,
  report_json jsonb NOT NULL,
  exported_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'generated'::text NOT NULL,
  title text,
  sections jsonb,
  evidence_policy text DEFAULT 'provisional-first'::text NOT NULL,
  peer_set_id text,
  peer_baseline_source text,
  peer_baseline_label text,
  peer_fallback_reason text,
  selected_source text DEFAULT 'manual'::text NOT NULL,
  selected_source_label text,
  selected_verified_fee_count integer DEFAULT 0 NOT NULL,
  selected_provisional_fee_count integer DEFAULT 0 NOT NULL,
  selected_fee_delta_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.hamilton_saved_analyses (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  institution_id text NOT NULL,
  title text NOT NULL,
  analysis_focus text NOT NULL,
  prompt text,
  response_json jsonb NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  question text,
  response text,
  model text
);
CREATE TABLE public.hamilton_scenarios (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  institution_id text NOT NULL,
  fee_category text NOT NULL,
  peer_set_id text,
  horizon text,
  current_value numeric NOT NULL,
  proposed_value numeric NOT NULL,
  result_json jsonb NOT NULL,
  confidence_tier text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  name text,
  changes jsonb,
  evidence_policy text DEFAULT 'verified-only'::text NOT NULL,
  peer_baseline_source text,
  peer_baseline_label text,
  peer_fallback_reason text,
  selected_source text DEFAULT 'manual'::text NOT NULL,
  selected_source_label text
);
CREATE TABLE public.hamilton_signals (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id text,
  signal_type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  source_json jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  canonical_fee_key text,
  payload jsonb
);
CREATE TABLE public.hamilton_watchlists (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  institution_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  fee_categories jsonb DEFAULT '[]'::jsonb NOT NULL,
  regions jsonb DEFAULT '[]'::jsonb NOT NULL,
  peer_set_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  name text,
  filters jsonb,
  notify_on_change boolean,
  selected_source text DEFAULT 'watchlist'::text NOT NULL,
  selected_source_label text
);
CREATE TABLE public.hamilton_workspace_contexts (  user_id integer NOT NULL,
  selected_institution_id integer,
  selected_source text DEFAULT 'manual'::text NOT NULL,
  last_intent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.historical_fee_observation_archive (  id bigint DEFAULT nextval('historical_fee_observation_archive_id_seq'::regclass) NOT NULL,
  source_document_id bigint,
  institution_id bigint NOT NULL,
  fee_name text NOT NULL,
  amount double precision,
  frequency text,
  conditions text,
  extraction_confidence double precision DEFAULT 0.0 NOT NULL,
  review_status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  validation_flags jsonb,
  fee_family text,
  fee_category text,
  account_product_type text,
  source text DEFAULT 'crawler'::text,
  extracted_by text,
  is_fee_cap boolean DEFAULT false,
  canonical_fee_key text,
  variant_type text
);
CREATE TABLE public.holding_company_financials (  id bigint DEFAULT nextval('holding_company_financials_id_seq'::regclass) NOT NULL,
  cik text NOT NULL,
  period_end date NOT NULL,
  fiscal_period text,
  total_assets bigint,
  total_liabilities bigint,
  stockholders_equity bigint,
  net_income bigint,
  eps_diluted double precision,
  source_url text,
  agent_run_id bigint,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_analysis_results (  id bigint DEFAULT nextval('institution_analysis_results_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  analysis_type text NOT NULL,
  result_json jsonb NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_branch_deposits (  id bigint DEFAULT nextval('institution_branch_deposits_id_seq'::regclass) NOT NULL,
  cert integer NOT NULL,
  institution_id bigint,
  year integer NOT NULL,
  branch_number integer NOT NULL,
  is_main_office boolean DEFAULT false NOT NULL,
  deposits bigint,
  state text,
  city text,
  county_fips integer,
  msa_code integer,
  msa_name text,
  fed_district integer,
  latitude double precision,
  longitude double precision,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  branch_name text,
  address text,
  zip text,
  agent_run_id bigint
);
CREATE TABLE public.institution_claim_events (  id bigint DEFAULT nextval('institution_claim_events_id_seq'::regclass) NOT NULL,
  claim_id bigint NOT NULL,
  actor_user_id bigint,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_claims (  id bigint DEFAULT nextval('institution_claims_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  claimant_user_id bigint NOT NULL,
  claimant_role text,
  claim_notes text,
  source_submission_id bigint,
  review_status text DEFAULT 'pending'::text NOT NULL,
  reviewed_at timestamp with time zone,
  reviewer_id bigint,
  review_notes text,
  resolution text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_complaint_records (  id bigint DEFAULT nextval('institution_complaint_records_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  report_period text NOT NULL,
  product text NOT NULL,
  issue text,
  complaint_count integer NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_dossiers (  institution_id integer NOT NULL,
  last_url_tried text,
  last_document_format text,
  last_strategy text,
  last_outcome text,
  last_cost_cents integer DEFAULT 0 NOT NULL,
  next_try_recommendation text,
  notes jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by_agent_event_id uuid,
  updated_by_agent text
);
CREATE TABLE public.institution_fee_alert_subscriptions (  id bigint DEFAULT nextval('institution_fee_alert_subscriptions_id_seq'::regclass) NOT NULL,
  user_id bigint NOT NULL,
  institution_id bigint NOT NULL,
  fee_categories text[],
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  last_alerted_at timestamp with time zone
);
CREATE TABLE public.institution_fee_snapshot_records (  id bigint DEFAULT nextval('institution_fee_snapshot_records_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  source_document_id bigint,
  snapshot_date text NOT NULL,
  fee_name text NOT NULL,
  fee_category text,
  amount double precision,
  frequency text,
  conditions text,
  account_product_type text,
  extraction_confidence double precision,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_filings (  id bigint DEFAULT nextval('institution_filings_id_seq'::regclass) NOT NULL,
  cik text NOT NULL,
  institution_id bigint,
  company_name text,
  form text NOT NULL,
  filed_at date NOT NULL,
  period_of_report date,
  accession_no text NOT NULL,
  primary_doc_url text,
  description text,
  agent_run_id bigint,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_financial_records (  id bigint DEFAULT nextval('institution_financial_records_id_seq'::regclass) NOT NULL,
  institution_id bigint,
  report_date text NOT NULL,
  source text NOT NULL,
  total_assets bigint,
  total_deposits bigint,
  total_loans bigint,
  service_charge_income bigint,
  other_noninterest_income bigint,
  net_interest_margin double precision,
  efficiency_ratio double precision,
  roa double precision,
  roe double precision,
  tier1_capital_ratio double precision,
  branch_count integer,
  employee_count integer,
  member_count integer,
  raw_json jsonb,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  total_revenue bigint,
  fee_income_ratio double precision,
  overdraft_revenue bigint,
  source_cert_number text,
  net_income bigint,
  net_interest_income bigint,
  noninterest_expense bigint,
  provision_for_losses bigint,
  net_charge_offs bigint,
  noncurrent_loans bigint,
  total_equity bigint,
  total_securities bigint,
  loans_real_estate bigint,
  loans_commercial bigint,
  loans_consumer bigint,
  loans_credit_card bigint,
  loans_auto bigint,
  loans_agricultural bigint,
  core_deposits bigint,
  brokered_deposits bigint,
  uninsured_deposits bigint,
  leverage_ratio double precision,
  total_capital_ratio double precision,
  net_charge_off_rate double precision,
  noncurrent_loan_rate double precision,
  source_url text,
  agent_run_id bigint
);
CREATE TABLE public.institution_identity_links (  id bigint DEFAULT nextval('institution_identity_links_id_seq'::regclass) NOT NULL,
  institution_id bigint,
  link_type text NOT NULL,
  external_key text NOT NULL,
  external_name text,
  method text NOT NULL,
  confidence double precision DEFAULT 0 NOT NULL,
  status text DEFAULT 'accepted'::text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  agent_run_id bigint,
  verified_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_source_corrections (  id bigint DEFAULT nextval('institution_source_corrections_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  agent_run_id integer,
  correction_type text NOT NULL,
  before_value jsonb DEFAULT '{}'::jsonb NOT NULL,
  after_value jsonb DEFAULT '{}'::jsonb NOT NULL,
  reason text,
  corrected_by text DEFAULT 'agent'::text NOT NULL,
  confidence numeric(5,4),
  accepted boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_source_profiles (  institution_id bigint NOT NULL,
  state_code text NOT NULL,
  canonical_source_url text,
  source_kind text DEFAULT 'unknown'::text NOT NULL,
  read_strategy text,
  last_source_hash text,
  last_successful_source_document_id bigint,
  last_successful_text_id bigint,
  last_success_at timestamp with time zone,
  last_failure_at timestamp with time zone,
  last_failure_reason text,
  consecutive_failures integer DEFAULT 0 NOT NULL,
  correction_version integer DEFAULT 0 NOT NULL,
  locked_by_correction boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  format text,
  platform text,
  layout_fingerprint text,
  best_strategy jsonb DEFAULT '{}'::jsonb NOT NULL,
  strategy_stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  expected_fee_count integer,
  do_not_retry jsonb DEFAULT '[]'::jsonb NOT NULL,
  cost_to_date_microusd bigint DEFAULT 0 NOT NULL,
  last_learned_at timestamp with time zone,
  rejected_source_urls jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.institution_sources (  id bigint DEFAULT nextval('institution_sources_id_seq'::regclass) NOT NULL,
  institution_name text NOT NULL,
  website_url text,
  fee_schedule_url text,
  charter_type text NOT NULL,
  state text,
  state_code character(2),
  city text,
  asset_size bigint,
  cert_number text,
  source text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  document_type text,
  last_content_hash text,
  last_crawl_at timestamp with time zone,
  last_success_at timestamp with time zone,
  consecutive_failures integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fed_district integer,
  asset_size_tier text,
  cbsa_code text,
  cbsa_name text,
  urban_rural text,
  established_date text,
  specialty text,
  failure_reason text,
  failure_reason_note text,
  failure_reason_updated_at timestamp with time zone,
  cms_platform text,
  cms_confidence double precision,
  document_r2_key text,
  document_type_detected text,
  doc_classification_confidence double precision,
  extraction_completeness_score double precision,
  extraction_completeness_label text,
  crawl_strategy text,
  rescue_status text,
  last_rescue_attempt_at timestamp with time zone,
  rssd_id text,
  ncua_charter_id text,
  routing_number text,
  lei text,
  holding_company_rssd text,
  holding_company_name text,
  primary_regulator text,
  charter_agency text,
  regulatory_status text,
  closed_date date,
  registry_synced_at timestamp with time zone,
  sec_cik text,
  cu_charter_type text
);
CREATE TABLE public.institution_workspace_invitations (  id bigint DEFAULT nextval('institution_workspace_invitations_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  email text NOT NULL,
  invited_role text DEFAULT 'analyst'::text NOT NULL,
  invitation_status text DEFAULT 'pending'::text NOT NULL,
  invited_by_user_id bigint NOT NULL,
  accepted_by_user_id bigint,
  revoked_by_user_id bigint,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.institution_workspace_memberships (  id bigint DEFAULT nextval('institution_workspace_memberships_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  user_id bigint NOT NULL,
  membership_role text DEFAULT 'owner'::text NOT NULL,
  membership_status text DEFAULT 'active'::text NOT NULL,
  source text DEFAULT 'claim'::text NOT NULL,
  claim_id bigint,
  granted_by_user_id bigint,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_by_user_id bigint,
  revoked_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.jobs (  id bigint DEFAULT nextval('jobs_id_seq'::regclass) NOT NULL,
  queue text,
  entity_id text NOT NULL,
  payload jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  run_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_by text,
  locked_at timestamp with time zone,
  completed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  job_type text,
  target_id bigint,
  result jsonb,
  updated_at timestamp with time zone
);
CREATE TABLE public.knox_overrides (  id bigint DEFAULT nextval('knox_overrides_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  rejection_msg_id uuid NOT NULL,
  fee_verified_id bigint,
  decision text NOT NULL,
  reviewer_id integer NOT NULL,
  note text,
  promoted_fee_published_id bigint
);
CREATE TABLE public.leads (  id bigint DEFAULT nextval('leads_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  company text,
  role text,
  use_case text,
  source text DEFAULT 'coming_soon'::text NOT NULL,
  status text DEFAULT 'new'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  email_confirmed_at timestamp with time zone,
  email_unsubscribed_at timestamp with time zone
);
CREATE TABLE public.market_concentration (  id bigint DEFAULT nextval('market_concentration_id_seq'::regclass) NOT NULL,
  year integer NOT NULL,
  msa_code integer NOT NULL,
  msa_name text,
  total_deposits bigint,
  institution_count integer,
  hhi integer,
  top3_share double precision,
  computed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.org_members (  id bigint DEFAULT nextval('org_members_id_seq'::regclass) NOT NULL,
  organization_id bigint NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  name text,
  role text DEFAULT 'member'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.organizations (  id bigint DEFAULT nextval('organizations_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  charter_type text,
  asset_tier text,
  cert_number text,
  stripe_customer_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pipeline_attempts (  id bigint DEFAULT nextval('pipeline_attempts_id_seq'::regclass) NOT NULL,
  institution_id bigint,
  source_document_id bigint,
  stage text NOT NULL,
  strategy text NOT NULL,
  strategy_version integer DEFAULT 1 NOT NULL,
  input_fingerprint text,
  outcome text NOT NULL,
  yield_count integer DEFAULT 0 NOT NULL,
  cost_microusd bigint DEFAULT 0 NOT NULL,
  duration_ms integer,
  agent_run_id bigint,
  agent_run_step_id bigint,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pipeline_runs (  id bigint DEFAULT nextval('pipeline_runs_id_seq1'::regclass) NOT NULL,
  trigger_source text DEFAULT 'manual'::text NOT NULL,
  triggered_by text DEFAULT 'pipeline_executor'::text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  params_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  workflow_run_id text,
  stages_total integer DEFAULT 0 NOT NULL,
  stages_done integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_completed_phase integer DEFAULT 0,
  last_completed_job text,
  config_json jsonb,
  completed_at timestamp with time zone,
  error_msg text,
  inst_count integer,
  summary_json jsonb
);
CREATE TABLE public.pipeline_steps (  id bigint DEFAULT nextval('pipeline_steps_id_seq'::regclass) NOT NULL,
  run_id bigint NOT NULL,
  stage text NOT NULL,
  seq integer NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  rows_in integer,
  rows_out integer,
  cost_cents integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error text,
  notes_json jsonb
);
CREATE TABLE public.platform_registry (  platform text NOT NULL,
  fee_paths text[],
  extraction_method text DEFAULT 'llm'::text NOT NULL,
  rule_enabled boolean DEFAULT false NOT NULL,
  validated_count integer DEFAULT 0 NOT NULL,
  success_rate double precision,
  institution_count integer,
  last_updated timestamp with time zone DEFAULT now()
);
CREATE TABLE public.public_discovery_findings (  id bigint DEFAULT nextval('public_discovery_findings_id_seq'::regclass) NOT NULL,
  observation_id bigint,
  agent_run_id integer,
  state_code text,
  route_template text,
  url text NOT NULL,
  issue_code text NOT NULL,
  severity text DEFAULT 'warning'::text NOT NULL,
  verified_status text DEFAULT 'unverified'::text NOT NULL,
  message text NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.public_discovery_observations (  id bigint DEFAULT nextval('public_discovery_observations_id_seq'::regclass) NOT NULL,
  agent_run_id integer,
  state_code text,
  route_template text,
  url text NOT NULL,
  source text DEFAULT 'magellan_public_discovery'::text NOT NULL,
  viewport text DEFAULT 'desktop'::text NOT NULL,
  status_code integer,
  final_url text,
  h1 text,
  title text,
  has_horizontal_overflow boolean DEFAULT false NOT NULL,
  console_error_count integer DEFAULT 0 NOT NULL,
  console_warning_count integer DEFAULT 0 NOT NULL,
  screenshot_path text,
  observed_at timestamp with time zone DEFAULT now() NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.published_fee_record_rollback_log (  rollback_id bigint DEFAULT nextval('published_fee_record_rollback_log_rollback_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  batch_id text NOT NULL,
  rolled_back_by text NOT NULL,
  affected_count integer NOT NULL,
  reason text,
  dry_run boolean DEFAULT true NOT NULL,
  category_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
  rollback_token text NOT NULL
);
CREATE TABLE public.published_fee_records (  fee_published_id bigint DEFAULT nextval('published_fee_records_fee_published_id_seq'::regclass) NOT NULL,
  published_at timestamp with time zone DEFAULT now() NOT NULL,
  lineage_ref bigint NOT NULL,
  institution_id integer NOT NULL,
  canonical_fee_key text NOT NULL,
  source_url text,
  document_r2_key text,
  extraction_confidence numeric(5,4),
  agent_event_id uuid,
  verified_by_agent_event_id uuid,
  published_by_adversarial_event_id uuid NOT NULL,
  fee_name text NOT NULL,
  amount numeric(12,2),
  frequency text,
  variant_type text,
  coverage_tier text,
  batch_id text,
  rolled_back_at timestamp with time zone,
  rolled_back_by_batch_id text,
  rolled_back_reason text
);
CREATE TABLE public.published_reports (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  job_id uuid,
  report_type text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  published_at timestamp with time zone DEFAULT now() NOT NULL,
  is_public boolean DEFAULT false NOT NULL,
  summary text,
  body text,
  published_by text,
  status text
);
CREATE TABLE public.raw_fee_observations (  fee_raw_id bigint DEFAULT nextval('raw_fee_observations_fee_raw_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  institution_id integer NOT NULL,
  source_document_id integer,
  document_r2_key text,
  source_url text,
  extraction_confidence numeric(5,4),
  agent_event_id uuid NOT NULL,
  fee_name text NOT NULL,
  amount numeric(12,2),
  frequency text,
  conditions text,
  outlier_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
  source text DEFAULT 'knox'::text NOT NULL
);
CREATE TABLE public.reg_articles (  guid text NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  link text NOT NULL,
  topic text DEFAULT 'general'::text NOT NULL,
  published_at text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.registry_ingest_partitions (  id bigint DEFAULT nextval('registry_ingest_partitions_id_seq'::regclass) NOT NULL,
  source text NOT NULL,
  partition_key text NOT NULL,
  status text DEFAULT 'scheduled'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  row_count integer,
  matched_count integer,
  unmatched_count integer,
  inserted_count integer,
  source_url text,
  agent_run_id bigint,
  last_error text,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  next_attempt_after timestamp with time zone DEFAULT now() NOT NULL,
  fetched_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.report_jobs (  id uuid DEFAULT gen_random_uuid() NOT NULL,
  report_type text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  params jsonb,
  data_manifest jsonb,
  artifact_key text,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  user_id integer,
  cancel_requested_at timestamp with time zone,
  agent_run_id integer
);
CREATE TABLE public.research_articles (  id bigint DEFAULT nextval('research_articles_id_seq'::regclass) NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  subtitle text,
  content text DEFAULT ''::text NOT NULL,
  category text DEFAULT 'analysis'::text NOT NULL,
  tags text,
  author text DEFAULT 'Bank Fee Index'::text,
  status text DEFAULT 'draft'::text NOT NULL,
  generated_by text,
  conversation_id integer,
  published_at text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  view_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.research_conversations (  id bigint DEFAULT nextval('research_conversations_id_seq'::regclass) NOT NULL,
  user_id bigint NOT NULL,
  agent_id text NOT NULL,
  title text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.research_messages (  id bigint DEFAULT nextval('research_messages_id_seq'::regclass) NOT NULL,
  conversation_id bigint NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  tool_calls text,
  token_count integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.research_usage (  id bigint DEFAULT nextval('research_usage_id_seq'::regclass) NOT NULL,
  user_id bigint,
  ip_address text,
  agent_id text NOT NULL,
  input_tokens integer DEFAULT 0 NOT NULL,
  output_tokens integer DEFAULT 0 NOT NULL,
  estimated_cost_cents integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.roomba_log (  id integer DEFAULT nextval('roomba_log_id_seq'::regclass) NOT NULL,
  fee_id integer NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.saved_peer_sets (  id bigint DEFAULT nextval('saved_peer_sets_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  tiers text,
  districts text,
  charter_type text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  filters jsonb
);
CREATE TABLE public.saved_subscriber_peer_groups (  id bigint DEFAULT nextval('saved_subscriber_peer_groups_id_seq'::regclass) NOT NULL,
  organization_id bigint,
  name text NOT NULL,
  charter_types text,
  asset_tiers text,
  districts text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id text,
  institution_ids integer[]
);
CREATE TABLE public.schema_migrations (  filename text NOT NULL,
  applied_at timestamp with time zone DEFAULT now() NOT NULL,
  applied_by text,
  checksum text
);
CREATE TABLE public.sessions (  id text NOT NULL,
  user_id bigint NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.shadow_outputs (  shadow_output_id bigint DEFAULT nextval('shadow_outputs_shadow_output_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  shadow_run_id uuid NOT NULL,
  agent_name text NOT NULL,
  entity text NOT NULL,
  payload_diff jsonb NOT NULL,
  agent_event_id uuid
);
CREATE TABLE public.source_collection_runs (  id bigint DEFAULT nextval('source_collection_runs_id_seq'::regclass) NOT NULL,
  trigger_type text DEFAULT 'scheduled'::text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  targets_total integer DEFAULT 0 NOT NULL,
  targets_crawled integer DEFAULT 0 NOT NULL,
  targets_succeeded integer DEFAULT 0 NOT NULL,
  targets_failed integer DEFAULT 0 NOT NULL,
  targets_unchanged integer DEFAULT 0 NOT NULL,
  fees_extracted integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  trigger text,
  heartbeat_at timestamp with time zone
);
CREATE TABLE public.source_documents (  id bigint DEFAULT nextval('source_documents_id_seq'::regclass) NOT NULL,
  source_collection_run_id bigint,
  institution_id bigint NOT NULL,
  status text NOT NULL,
  document_url text,
  document_path text,
  content_hash text,
  fees_extracted integer DEFAULT 0 NOT NULL,
  error_message text,
  crawled_at timestamp with time zone DEFAULT now() NOT NULL,
  status_code integer,
  etag text,
  last_modified text,
  last_checked_at timestamp with time zone,
  document_r2_key text,
  content_type text,
  byte_size bigint,
  duplicate_of_id bigint
);
CREATE TABLE public.source_validation_queue (  id bigint DEFAULT nextval('source_validation_queue_id_seq'::regclass) NOT NULL,
  institution_id bigint NOT NULL,
  submission_id bigint,
  source_url text NOT NULL,
  queue_status text DEFAULT 'manual_validation_needed'::text NOT NULL,
  validation_mode text DEFAULT 'manual'::text NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  created_by_user_id integer,
  agent_run_id integer,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.state_regulators (  state_code character(2) NOT NULL,
  state_name text NOT NULL,
  agency_name text NOT NULL,
  website_url text,
  credit_union_agency_name text,
  credit_union_website_url text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.stripe_events (  id bigint DEFAULT nextval('stripe_events_id_seq'::regclass) NOT NULL,
  stripe_event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.subscriptions (  id bigint DEFAULT nextval('subscriptions_id_seq'::regclass) NOT NULL,
  organization_id bigint NOT NULL,
  stripe_subscription_id text NOT NULL,
  plan text DEFAULT 'starter'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  current_period_start text NOT NULL,
  current_period_end text NOT NULL,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.usage_events (  id bigint DEFAULT nextval('usage_events_id_seq'::regclass) NOT NULL,
  organization_id bigint,
  anonymous_id text,
  event_type text NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.users (  id bigint DEFAULT nextval('users_id_seq'::regclass) NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text DEFAULT 'viewer'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  email text,
  stripe_customer_id text,
  subscription_status text DEFAULT 'none'::text,
  institution_name text,
  institution_type text,
  asset_tier text,
  state_code character(2),
  job_role text,
  interests jsonb,
  fed_district integer,
  past_due_since timestamp with time zone
);
CREATE TABLE public.verified_fee_observations (  fee_verified_id bigint DEFAULT nextval('verified_fee_observations_fee_verified_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fee_raw_id bigint NOT NULL,
  institution_id integer NOT NULL,
  source_url text,
  document_r2_key text,
  extraction_confidence numeric(5,4),
  canonical_fee_key text NOT NULL,
  variant_type text,
  outlier_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
  verified_by_agent_event_id uuid NOT NULL,
  fee_name text NOT NULL,
  amount numeric(12,2),
  frequency text,
  review_status text DEFAULT 'verified'::text NOT NULL,
  validation_flags jsonb GENERATED ALWAYS AS (outlier_flags) STORED,
  fee_category text GENERATED ALWAYS AS (canonical_fee_key) STORED
);
CREATE TABLE public.wave_runs (  id integer DEFAULT nextval('wave_runs_id_seq'::regclass) NOT NULL,
  states text[],
  wave_size integer NOT NULL,
  total_states integer NOT NULL,
  completed_states integer DEFAULT 0,
  failed_states integer DEFAULT 0,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  campaign_id text,
  wave_type text,
  state_codes text[],
  planned_targets integer
);
CREATE TABLE public.wave_state_runs (  id integer DEFAULT nextval('wave_state_runs_id_seq'::regclass) NOT NULL,
  wave_run_id integer NOT NULL,
  state_code text NOT NULL,
  status text DEFAULT 'pending'::text,
  agent_run_id integer,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error text,
  extracted_count integer,
  failure_reason text,
  updated_at timestamp with time zone
);
CREATE TABLE public.workers_last_run (  job_name text NOT NULL,
  completed_at timestamp with time zone,
  status text,
  notes text
);ALTER TABLE public.agent_auth_log_2026_04 ADD CONSTRAINT agent_auth_log_2026_04_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_05 ADD CONSTRAINT agent_auth_log_2026_05_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_06 ADD CONSTRAINT agent_auth_log_2026_06_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_07 ADD CONSTRAINT agent_auth_log_2026_07_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_08 ADD CONSTRAINT agent_auth_log_2026_08_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_09 ADD CONSTRAINT agent_auth_log_2026_09_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_10 ADD CONSTRAINT agent_auth_log_2026_10_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_2026_11 ADD CONSTRAINT agent_auth_log_2026_11_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log_default ADD CONSTRAINT agent_auth_log_default_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_auth_log ADD CONSTRAINT agent_auth_log_pkey PRIMARY KEY (auth_id, created_at);
ALTER TABLE public.agent_budgets ADD CONSTRAINT agent_budgets_pkey PRIMARY KEY (agent_name, budget_window);
ALTER TABLE public.agent_events_2026_04 ADD CONSTRAINT agent_events_2026_04_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_05 ADD CONSTRAINT agent_events_2026_05_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_06 ADD CONSTRAINT agent_events_2026_06_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_07 ADD CONSTRAINT agent_events_2026_07_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_08 ADD CONSTRAINT agent_events_2026_08_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_09 ADD CONSTRAINT agent_events_2026_09_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_10 ADD CONSTRAINT agent_events_2026_10_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_2026_11 ADD CONSTRAINT agent_events_2026_11_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events_default ADD CONSTRAINT agent_events_default_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_pkey PRIMARY KEY (event_id, created_at);
ALTER TABLE public.agent_health_rollup ADD CONSTRAINT agent_health_rollup_pkey PRIMARY KEY (agent_name, bucket_start);
ALTER TABLE public.agent_institution_run_results ADD CONSTRAINT agent_institution_run_results_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_lessons ADD CONSTRAINT agent_lessons_pkey PRIMARY KEY (lesson_id);
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (message_id);
ALTER TABLE public.agent_registry ADD CONSTRAINT agent_registry_pkey PRIMARY KEY (agent_name);
ALTER TABLE public.agent_run_events ADD CONSTRAINT agent_run_events_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_state_lanes ADD CONSTRAINT agent_state_lanes_pkey PRIMARY KEY (state_code);
ALTER TABLE public.agent_url_discovery_attempts ADD CONSTRAINT agent_url_discovery_attempts_pkey PRIMARY KEY (institution_id, discovery_method);
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_pkey PRIMARY KEY (id);
ALTER TABLE public.alert_preferences ADD CONSTRAINT alert_preferences_pkey PRIMARY KEY (id);
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_pkey PRIMARY KEY (id);
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_pkey PRIMARY KEY (id);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_pkey PRIMARY KEY (id);
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE public.articles ADD CONSTRAINT articles_pkey PRIMARY KEY (id);
ALTER TABLE public.automation_control_audit ADD CONSTRAINT automation_control_audit_pkey PRIMARY KEY (id);
ALTER TABLE public.automation_control ADD CONSTRAINT automation_control_pkey PRIMARY KEY (control_key);
ALTER TABLE public.beige_book_themes ADD CONSTRAINT beige_book_themes_pkey PRIMARY KEY (id);
ALTER TABLE public.canary_runs ADD CONSTRAINT canary_runs_pkey PRIMARY KEY (run_id);
ALTER TABLE public.census_tracts ADD CONSTRAINT census_tracts_pkey PRIMARY KEY (id);
ALTER TABLE public.classification_cache ADD CONSTRAINT classification_cache_pkey PRIMARY KEY (id);
ALTER TABLE public.classification_history ADD CONSTRAINT classification_history_pkey PRIMARY KEY (id);
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_pkey PRIMARY KEY (id);
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_pkey PRIMARY KEY (id);
ALTER TABLE public.consumer_guide_revisions ADD CONSTRAINT consumer_guide_revisions_pkey PRIMARY KEY (id);
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_pkey PRIMARY KEY (id);
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_pkey PRIMARY KEY (id);
ALTER TABLE public.coverage_snapshots ADD CONSTRAINT coverage_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.demographics ADD CONSTRAINT demographics_pkey PRIMARY KEY (id);
ALTER TABLE public.external_intelligence ADD CONSTRAINT external_intelligence_pkey PRIMARY KEY (id);
ALTER TABLE public.fed_beige_book ADD CONSTRAINT fed_beige_book_pkey PRIMARY KEY (id);
ALTER TABLE public.fed_content ADD CONSTRAINT fed_content_pkey PRIMARY KEY (id);
ALTER TABLE public.fed_economic_indicators ADD CONSTRAINT fed_economic_indicators_pkey PRIMARY KEY (id);
ALTER TABLE public.fee_change_records ADD CONSTRAINT fee_change_records_pkey PRIMARY KEY (id);
ALTER TABLE public.fee_index_cache ADD CONSTRAINT fee_index_cache_pkey PRIMARY KEY (fee_category);
ALTER TABLE public.fee_reviews ADD CONSTRAINT fee_reviews_pkey PRIMARY KEY (id);
ALTER TABLE public.gold_standard_verifications ADD CONSTRAINT gold_standard_verifications_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_conversations ADD CONSTRAINT hamilton_conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_digest_runs ADD CONSTRAINT hamilton_digest_runs_pkey PRIMARY KEY (run_id);
ALTER TABLE public.hamilton_digest_subscriptions ADD CONSTRAINT hamilton_digest_subscriptions_pkey PRIMARY KEY (subscription_id);
ALTER TABLE public.hamilton_messages ADD CONSTRAINT hamilton_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_priority_alerts ADD CONSTRAINT hamilton_priority_alerts_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_refresh_job_completions ADD CONSTRAINT hamilton_refresh_job_completions_pkey PRIMARY KEY (job_id, user_id);
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_reports ADD CONSTRAINT hamilton_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_saved_analyses ADD CONSTRAINT hamilton_saved_analyses_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_scenarios ADD CONSTRAINT hamilton_scenarios_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_signals ADD CONSTRAINT hamilton_signals_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_watchlists ADD CONSTRAINT hamilton_watchlists_pkey PRIMARY KEY (id);
ALTER TABLE public.hamilton_workspace_contexts ADD CONSTRAINT hamilton_workspace_contexts_pkey PRIMARY KEY (user_id);
ALTER TABLE public.historical_fee_observation_archive ADD CONSTRAINT historical_fee_observation_archive_pkey PRIMARY KEY (id);
ALTER TABLE public.holding_company_financials ADD CONSTRAINT holding_company_financials_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_analysis_results ADD CONSTRAINT institution_analysis_results_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_branch_deposits ADD CONSTRAINT institution_branch_deposits_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_claim_events ADD CONSTRAINT institution_claim_events_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_complaint_records ADD CONSTRAINT institution_complaint_records_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_pkey PRIMARY KEY (institution_id);
ALTER TABLE public.institution_fee_alert_subscriptions ADD CONSTRAINT institution_fee_alert_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_fee_snapshot_records ADD CONSTRAINT institution_fee_snapshot_records_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_filings ADD CONSTRAINT institution_filings_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_financial_records ADD CONSTRAINT institution_financial_records_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_identity_links ADD CONSTRAINT institution_identity_links_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_source_corrections ADD CONSTRAINT institution_source_corrections_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_pkey PRIMARY KEY (institution_id);
ALTER TABLE public.institution_sources ADD CONSTRAINT institution_sources_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_pkey PRIMARY KEY (id);
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_pkey PRIMARY KEY (id);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.knox_overrides ADD CONSTRAINT knox_overrides_pkey PRIMARY KEY (id);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.market_concentration ADD CONSTRAINT market_concentration_pkey PRIMARY KEY (id);
ALTER TABLE public.org_members ADD CONSTRAINT org_members_pkey PRIMARY KEY (id);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.pipeline_runs ADD CONSTRAINT pipeline_runs_pkey1 PRIMARY KEY (id);
ALTER TABLE public.pipeline_steps ADD CONSTRAINT pipeline_steps_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_registry ADD CONSTRAINT platform_registry_pkey PRIMARY KEY (platform);
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_pkey PRIMARY KEY (id);
ALTER TABLE public.public_discovery_observations ADD CONSTRAINT public_discovery_observations_pkey PRIMARY KEY (id);
ALTER TABLE public.published_fee_record_rollback_log ADD CONSTRAINT published_fee_record_rollback_log_pkey PRIMARY KEY (rollback_id);
ALTER TABLE public.published_fee_records ADD CONSTRAINT published_fee_records_pkey PRIMARY KEY (fee_published_id);
ALTER TABLE public.published_reports ADD CONSTRAINT published_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.raw_fee_observations ADD CONSTRAINT raw_fee_observations_pkey PRIMARY KEY (fee_raw_id);
ALTER TABLE public.reg_articles ADD CONSTRAINT reg_articles_pkey PRIMARY KEY (guid);
ALTER TABLE public.registry_ingest_partitions ADD CONSTRAINT registry_ingest_partitions_pkey PRIMARY KEY (id);
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.research_articles ADD CONSTRAINT research_articles_pkey PRIMARY KEY (id);
ALTER TABLE public.research_conversations ADD CONSTRAINT research_conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.research_messages ADD CONSTRAINT research_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.research_usage ADD CONSTRAINT research_usage_pkey PRIMARY KEY (id);
ALTER TABLE public.roomba_log ADD CONSTRAINT roomba_log_pkey PRIMARY KEY (id);
ALTER TABLE public.saved_peer_sets ADD CONSTRAINT saved_peer_sets_pkey PRIMARY KEY (id);
ALTER TABLE public.saved_subscriber_peer_groups ADD CONSTRAINT saved_subscriber_peer_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.schema_migrations ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.shadow_outputs ADD CONSTRAINT shadow_outputs_pkey PRIMARY KEY (shadow_output_id);
ALTER TABLE public.source_collection_runs ADD CONSTRAINT source_collection_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.state_regulators ADD CONSTRAINT state_regulators_pkey PRIMARY KEY (state_code);
ALTER TABLE public.stripe_events ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.usage_events ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.verified_fee_observations ADD CONSTRAINT verified_fee_observations_pkey PRIMARY KEY (fee_verified_id);
ALTER TABLE public.wave_runs ADD CONSTRAINT wave_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.wave_state_runs ADD CONSTRAINT wave_state_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.workers_last_run ADD CONSTRAINT workers_last_run_pkey PRIMARY KEY (job_name);
ALTER TABLE public.agent_lessons ADD CONSTRAINT agent_lessons_agent_name_lesson_name_key UNIQUE (agent_name, lesson_name);
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_agent_run_id_step_key_key UNIQUE (agent_run_id, step_key);
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_source_document_id_key UNIQUE (source_document_id);
ALTER TABLE public.alert_preferences ADD CONSTRAINT alert_preferences_organization_id_key UNIQUE (organization_id);
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_policy_key_key UNIQUE (policy_key);
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_policy_id_window_key_window_start_key UNIQUE (policy_id, window_key, window_start);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_route_id_subject_type_subject_key_win_key UNIQUE (route_id, subject_type, subject_key, window_start);
ALTER TABLE public.articles ADD CONSTRAINT articles_slug_key UNIQUE (slug);
ALTER TABLE public.beige_book_themes ADD CONSTRAINT beige_book_themes_release_code_fed_district_theme_category_key UNIQUE (release_code, fed_district, theme_category);
ALTER TABLE public.census_tracts ADD CONSTRAINT census_tracts_tract_id_year_key UNIQUE (tract_id, year);
ALTER TABLE public.classification_cache ADD CONSTRAINT classification_cache_cache_key_uniq UNIQUE (cache_key);
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_anchor_unique UNIQUE (guide_id, anchor);
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_slug_key UNIQUE (slug);
ALTER TABLE public.coverage_snapshots ADD CONSTRAINT coverage_snapshots_snapshot_date_key UNIQUE (snapshot_date);
ALTER TABLE public.demographics ADD CONSTRAINT demographics_geo_id_geo_type_year_key UNIQUE (geo_id, geo_type, year);
ALTER TABLE public.fed_beige_book ADD CONSTRAINT fed_beige_book_release_code_fed_district_section_name_key UNIQUE (release_code, fed_district, section_name);
ALTER TABLE public.fed_content ADD CONSTRAINT fed_content_source_url_key UNIQUE (source_url);
ALTER TABLE public.fed_economic_indicators ADD CONSTRAINT fed_economic_indicators_series_id_observation_date_key UNIQUE (series_id, observation_date);
ALTER TABLE public.gold_standard_verifications ADD CONSTRAINT gold_standard_verifications_fee_id_key UNIQUE (fee_id);
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_source_signal_id_job_type_key UNIQUE (source_signal_id, job_type);
ALTER TABLE public.holding_company_financials ADD CONSTRAINT holding_company_financials_cik_period_key UNIQUE (cik, period_end);
ALTER TABLE public.institution_analysis_results ADD CONSTRAINT institution_analysis_results_institution_type_key UNIQUE (institution_id, analysis_type);
ALTER TABLE public.institution_branch_deposits ADD CONSTRAINT institution_branch_deposits_cert_year_branch_number_key UNIQUE (cert, year, branch_number);
ALTER TABLE public.institution_complaint_records ADD CONSTRAINT institution_complaint_records_inst_period_product_issue_key UNIQUE (institution_id, report_period, product, issue);
ALTER TABLE public.institution_fee_alert_subscriptions ADD CONSTRAINT institution_fee_alert_subscriptions_user_institution_key UNIQUE (user_id, institution_id);
ALTER TABLE public.institution_fee_snapshot_records ADD CONSTRAINT institution_fee_snapshot_records_institution_date_category_key UNIQUE (institution_id, snapshot_date, fee_category);
ALTER TABLE public.institution_filings ADD CONSTRAINT institution_filings_accession_key UNIQUE (accession_no);
ALTER TABLE public.institution_financial_records ADD CONSTRAINT institution_financial_records_institution_report_source_key UNIQUE (institution_id, report_date, source);
ALTER TABLE public.institution_identity_links ADD CONSTRAINT institution_identity_links_type_key UNIQUE (link_type, external_key);
ALTER TABLE public.institution_sources ADD CONSTRAINT institution_sources_source_cert_number_key UNIQUE (source, cert_number);
ALTER TABLE public.market_concentration ADD CONSTRAINT market_concentration_year_msa_code_key UNIQUE (year, msa_code);
ALTER TABLE public.org_members ADD CONSTRAINT org_members_organization_id_email_key UNIQUE (organization_id, email);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_stripe_customer_id_key UNIQUE (stripe_customer_id);
ALTER TABLE public.pipeline_steps ADD CONSTRAINT pipeline_steps_run_id_stage_key UNIQUE (run_id, stage);
ALTER TABLE public.published_fee_record_rollback_log ADD CONSTRAINT published_fee_record_rollback_log_rollback_token_key UNIQUE (rollback_token);
ALTER TABLE public.published_reports ADD CONSTRAINT published_reports_slug_key UNIQUE (slug);
ALTER TABLE public.registry_ingest_partitions ADD CONSTRAINT registry_ingest_partitions_source_partition_key UNIQUE (source, partition_key);
ALTER TABLE public.research_articles ADD CONSTRAINT research_articles_slug_key UNIQUE (slug);
ALTER TABLE public.stripe_events ADD CONSTRAINT stripe_events_stripe_event_id_key UNIQUE (stripe_event_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE public.wave_state_runs ADD CONSTRAINT wave_state_runs_wave_run_id_state_code_key UNIQUE (wave_run_id, state_code);
ALTER TABLE public.agent_auth_log_2026_04 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_05 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_06 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_07 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_08 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_09 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_10 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_2026_11 ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log_default ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_auth_log ADD CONSTRAINT agent_auth_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['agent'::text, 'user'::text, 'system'::text])));
ALTER TABLE public.agent_budgets ADD CONSTRAINT agent_budgets_budget_window_check CHECK ((budget_window = ANY (ARRAY['per_cycle'::text, 'per_batch'::text, 'per_report'::text, 'per_day'::text, 'per_month'::text])));
ALTER TABLE public.agent_budgets ADD CONSTRAINT agent_budgets_limit_cents_check CHECK ((limit_cents >= 0));
ALTER TABLE public.agent_budgets ADD CONSTRAINT agent_budgets_spent_cents_check CHECK ((spent_cents >= 0));
ALTER TABLE public.agent_events_2026_04 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_05 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_06 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_07 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_08 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_09 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_10 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_2026_11 ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events_default ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'success'::text, 'error'::text, 'budget_halt'::text, 'improve_rejected'::text, 'shadow_diff'::text])));
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_intent_check CHECK ((intent = ANY (ARRAY['challenge'::text, 'prove'::text, 'accept'::text, 'reject'::text, 'escalate'::text, 'coverage_request'::text, 'clarify'::text])));
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_state_check CHECK ((state = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text, 'escalated'::text, 'expired'::text])));
ALTER TABLE public.agent_registry ADD CONSTRAINT agent_registry_check CHECK ((((role = 'state_agent'::text) AND (state_code IS NOT NULL) AND (length(state_code) = 2)) OR ((role <> 'state_agent'::text) AND (state_code IS NULL))));
ALTER TABLE public.agent_registry ADD CONSTRAINT agent_registry_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['q1_validation'::text, 'q2_high_confidence'::text, 'q3_autonomy'::text, 'paused'::text])));
ALTER TABLE public.agent_registry ADD CONSTRAINT agent_registry_role_check CHECK ((role = ANY (ARRAY['supervisor'::text, 'data'::text, 'classifier'::text, 'orchestrator'::text, 'analyst'::text, 'state_agent'::text])));
ALTER TABLE public.agent_run_events ADD CONSTRAINT agent_run_events_status_check CHECK ((status = ANY (ARRAY['info'::text, 'queued'::text, 'running'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'skipped'::text, 'cancel_requested'::text, 'cancelled'::text, 'budget_halt'::text])));
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'cancel_requested'::text, 'cancelled'::text, 'skipped'::text])));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_actual_estimated_cost_microusd_check CHECK ((actual_estimated_cost_microusd >= 0));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_actual_provider_calls_check CHECK ((actual_provider_calls >= 0));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_max_estimated_cost_microusd_check CHECK (((max_estimated_cost_microusd IS NULL) OR (max_estimated_cost_microusd >= 0)));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_max_provider_calls_check CHECK (((max_provider_calls IS NULL) OR (max_provider_calls >= 0)));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_run_kind_check CHECK ((run_kind = ANY (ARRAY['workflow'::text, 'workflow_lane'::text, 'state_agent'::text, 'report'::text, 'manual_repair'::text, 'dry_run'::text, 'pro_request'::text])));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'blocked'::text, 'complete'::text, 'completed'::text, 'failed'::text, 'cancel_requested'::text, 'cancelled'::text])));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['schedule'::text, 'admin'::text, 'api'::text, 'agent'::text])));
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'empty'::text, 'needs_ocr'::text, 'failed'::text, 'skipped'::text, 'wrong_document'::text])));
ALTER TABLE public.agent_state_lanes ADD CONSTRAINT agent_state_lanes_freshness_positive_check CHECK ((freshness_target_hours > 0));
ALTER TABLE public.agent_state_lanes ADD CONSTRAINT agent_state_lanes_state_code_check CHECK (((state_code = upper(state_code)) AND ((length(state_code) >= 2) AND (length(state_code) <= 3))));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_cache_creation_input_tokens_check CHECK ((cache_creation_input_tokens >= 0));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_cache_read_input_tokens_check CHECK ((cache_read_input_tokens >= 0));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_estimated_cost_microusd_check CHECK (((estimated_cost_microusd IS NULL) OR (estimated_cost_microusd >= 0)));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_input_tokens_check CHECK ((input_tokens >= 0));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_output_tokens_check CHECK ((output_tokens >= 0));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_request_count_check CHECK ((request_count >= 0));
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'failed'::text, 'blocked'::text])));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_agent_scope_check CHECK (((scope <> 'agent'::text) OR (agent_name IS NOT NULL)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_hard_daily_microusd_check CHECK (((hard_daily_microusd IS NULL) OR (hard_daily_microusd >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_hard_monthly_microusd_check CHECK (((hard_monthly_microusd IS NULL) OR (hard_monthly_microusd >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_estimated_cost_per_run_microusd_check CHECK (((max_estimated_cost_per_run_microusd IS NULL) OR (max_estimated_cost_per_run_microusd >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_estimated_cost_per_tick_microusd_check CHECK (((max_estimated_cost_per_tick_microusd IS NULL) OR (max_estimated_cost_per_tick_microusd >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_provider_calls_per_run_check CHECK (((max_provider_calls_per_run IS NULL) OR (max_provider_calls_per_run >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_provider_calls_per_tick_check CHECK (((max_provider_calls_per_tick IS NULL) OR (max_provider_calls_per_tick >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_provider_calls_per_window_check CHECK (((max_provider_calls_per_window IS NULL) OR (max_provider_calls_per_window >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_max_requests_per_window_check CHECK (((max_requests_per_window IS NULL) OR (max_requests_per_window >= 0)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_route_scope_check CHECK (((scope <> 'route'::text) OR (route_id IS NOT NULL)));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'route'::text, 'agent'::text, 'user'::text, 'ip'::text, 'cron_tick'::text, 'agent_run'::text])));
ALTER TABLE public.api_budget_policies ADD CONSTRAINT api_budget_policies_window_seconds_check CHECK (((window_seconds IS NULL) OR (window_seconds > 0)));
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_actual_microusd_check CHECK ((actual_microusd >= 0));
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_provider_call_count_check CHECK ((provider_call_count >= 0));
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_request_count_check CHECK ((request_count >= 0));
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_reserved_microusd_check CHECK ((reserved_microusd >= 0));
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_time_check CHECK ((window_end > window_start));
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_event_type_check CHECK ((event_type = ANY (ARRAY['reservation'::text, 'blocked'::text, 'reset'::text])));
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_limit_count_check CHECK ((limit_count >= 0));
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_request_count_check CHECK ((request_count >= 0));
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['organization'::text, 'anonymous'::text, 'user'::text, 'ip'::text])));
ALTER TABLE public.api_rate_limit_events ADD CONSTRAINT api_rate_limit_events_time_check CHECK ((window_end > window_start));
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)));
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'error'::text, 'blocked'::text, 'rate_limited'::text, 'unauthorized'::text])));
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_status_code_check CHECK (((status_code IS NULL) OR (status_code >= 100)));
ALTER TABLE public.automation_control_audit ADD CONSTRAINT automation_control_audit_action_check CHECK ((action = ANY (ARRAY['emergency_stop'::text, 'resume'::text, 'pipeline_pause'::text, 'pipeline_resume'::text, 'billing_resolved'::text])));
ALTER TABLE public.automation_control ADD CONSTRAINT automation_control_key_check CHECK ((control_key = ANY (ARRAY['global'::text, 'pipeline'::text])));
ALTER TABLE public.canary_runs ADD CONSTRAINT canary_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'passed'::text, 'failed'::text, 'error'::text])));
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_event_type_check CHECK ((event_type = ANY (ARRAY['submitted'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text, 'linked_source'::text, 'queued_validation'::text, 'manual_note'::text])));
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_status_check CHECK ((((previous_status IS NULL) OR (previous_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text]))) AND (new_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text]))));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['ready_for_validation_when_automation_resumes'::text, 'manual_validation_needed'::text, 'rejected_not_official'::text, 'needs_more_context'::text]))));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_review_metadata_check CHECK ((((review_status = 'pending'::text) AND (reviewed_at IS NULL) AND (reviewer_id IS NULL) AND (resolution IS NULL)) OR ((review_status <> 'pending'::text) AND (reviewed_at IS NOT NULL) AND (reviewer_id IS NOT NULL) AND (resolution IS NOT NULL))));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text])));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_source_url_http_check CHECK ((btrim(source_url) ~* '^https?://'::text));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_submission_kind_check CHECK ((submission_kind = ANY (ARRAY['fee_row'::text, 'source_intake'::text])));
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_submitter_role_check CHECK (((submitter_role IS NULL) OR (submitter_role = ANY (ARRAY['consumer'::text, 'institution_employee'::text, 'consultant'::text, 'other'::text]))));
ALTER TABLE public.consumer_guide_revisions ADD CONSTRAINT consumer_guide_revisions_snapshot_object_check CHECK ((jsonb_typeof(snapshot) = 'object'::text));
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_anchor_format_check CHECK ((anchor ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_blocks_array_check CHECK ((jsonb_typeof(blocks) = 'array'::text));
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_position_check CHECK (("position" >= 0));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_access_tier_check CHECK ((access_tier = ANY (ARRAY['public'::text, 'registered'::text, 'pro'::text])));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_audience_check CHECK ((audience = ANY (ARRAY['consumer'::text, 'professional'::text])));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_consumer_is_public_check CHECK (((audience <> 'consumer'::text) OR (access_tier = 'public'::text)));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_primary_not_in_related_check CHECK ((NOT (primary_category = ANY (related_categories))));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_published_metadata_check CHECK (((status <> 'published'::text) OR ((published_at IS NOT NULL) AND (reviewed_at IS NOT NULL))));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_regulatory_approval_check CHECK (((regulatory_approved_by IS NULL) = (regulatory_approved_at IS NULL)));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_regulatory_gate_check CHECK (((status <> 'published'::text) OR (carries_regulatory_content = false) OR (regulatory_approved_at IS NOT NULL)));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_slug_format_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_review'::text, 'regulatory_review'::text, 'published'::text, 'archived'::text])));
ALTER TABLE public.external_intelligence ADD CONSTRAINT external_intelligence_category_check CHECK ((category = ANY (ARRAY['research'::text, 'survey'::text, 'regulation'::text, 'news'::text, 'analysis'::text])));
ALTER TABLE public.gold_standard_verifications ADD CONSTRAINT gold_standard_verifications_verdict_check CHECK ((verdict = ANY (ARRAY['correct'::text, 'incorrect'::text])));
ALTER TABLE public.hamilton_digest_runs ADD CONSTRAINT hamilton_digest_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text])));
ALTER TABLE public.hamilton_digest_subscriptions ADD CONSTRAINT hamilton_digest_subscriptions_cadence_check CHECK ((cadence = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])));
ALTER TABLE public.hamilton_digest_subscriptions ADD CONSTRAINT hamilton_digest_subscriptions_delivery_check CHECK ((delivery = ANY (ARRAY['email'::text, 'inbox'::text])));
ALTER TABLE public.hamilton_digest_subscriptions ADD CONSTRAINT hamilton_digest_subscriptions_prompt_check CHECK ((length(prompt) > 0));
ALTER TABLE public.hamilton_messages ADD CONSTRAINT hamilton_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE public.hamilton_priority_alerts ADD CONSTRAINT hamilton_priority_alerts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'acknowledged'::text, 'dismissed'::text])));
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['report_refresh'::text, 'scenario_refresh'::text, 'watchlist_review'::text])));
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_priority_check CHECK (((priority >= 1) AND (priority <= 3)));
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'completed'::text, 'dismissed'::text])));
ALTER TABLE public.hamilton_saved_analyses ADD CONSTRAINT hamilton_saved_analyses_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
ALTER TABLE public.hamilton_scenarios ADD CONSTRAINT hamilton_scenarios_confidence_tier_check CHECK ((confidence_tier = ANY (ARRAY['strong'::text, 'provisional'::text, 'insufficient'::text])));
ALTER TABLE public.hamilton_scenarios ADD CONSTRAINT hamilton_scenarios_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
ALTER TABLE public.hamilton_workspace_contexts ADD CONSTRAINT hamilton_workspace_contexts_selected_source_check CHECK ((selected_source = ANY (ARRAY['url'::text, 'manual'::text, 'profile'::text, 'watchlist'::text])));
ALTER TABLE public.institution_claim_events ADD CONSTRAINT institution_claim_events_event_type_check CHECK ((event_type = ANY (ARRAY['submitted'::text, 'resubmitted'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text, 'manual_note'::text])));
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['verified_claim'::text, 'rejected_not_authorized'::text, 'needs_more_context'::text, 'duplicate_claim'::text, 'withdrawn'::text]))));
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_review_metadata_check CHECK ((((review_status = 'pending'::text) AND (reviewed_at IS NULL) AND (reviewer_id IS NULL) AND (resolution IS NULL)) OR ((review_status <> 'pending'::text) AND (reviewed_at IS NOT NULL) AND (reviewer_id IS NOT NULL) AND (resolution IS NOT NULL))));
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'needs_info'::text])));
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_last_cost_cents_check CHECK ((last_cost_cents >= 0));
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_last_document_format_check CHECK (((last_document_format = ANY (ARRAY['pdf'::text, 'html'::text, 'js_rendered'::text, 'stealth_pass_1'::text, 'stealth_pass_2'::text, 'unknown'::text])) OR (last_document_format IS NULL)));
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_last_outcome_check CHECK (((last_outcome = ANY (ARRAY['success'::text, 'blocked'::text, '404'::text, 'no_fees'::text, 'captcha'::text, 'rate_limited'::text, 'unknown'::text])) OR (last_outcome IS NULL)));
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_next_try_recommendation_check CHECK (((next_try_recommendation = ANY (ARRAY['retry_same'::text, 'stealth_pass_1'::text, 'needs_playwright_stealth'::text, 'skip'::text, 'rediscover_url'::text])) OR (next_try_recommendation IS NULL)));
ALTER TABLE public.institution_identity_links ADD CONSTRAINT institution_identity_links_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'needs_review'::text, 'rejected'::text])));
ALTER TABLE public.institution_identity_links ADD CONSTRAINT institution_identity_links_type_check CHECK ((link_type = ANY (ARRAY['cfpb_company'::text, 'sec_cik'::text])));
ALTER TABLE public.institution_source_corrections ADD CONSTRAINT institution_source_corrections_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
ALTER TABLE public.institution_source_corrections ADD CONSTRAINT institution_source_corrections_type_check CHECK ((correction_type = ANY (ARRAY['canonical_source_url'::text, 'source_kind'::text, 'read_strategy'::text, 'offline'::text, 'bad_source'::text, 'manual_review'::text, 'other'::text])));
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_failures_nonnegative_check CHECK ((consecutive_failures >= 0));
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_format_check CHECK (((format IS NULL) OR (format = ANY (ARRAY['pdf_text'::text, 'pdf_scanned'::text, 'html_static'::text, 'html_js'::text, 'docx'::text, 'text'::text, 'other'::text]))));
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_read_strategy_check CHECK (((read_strategy IS NULL) OR (read_strategy = ANY (ARRAY['pdf_text'::text, 'html_dom'::text, 'browser_render'::text, 'ocr'::text, 'manual_review'::text]))));
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_source_kind_check CHECK ((source_kind = ANY (ARRAY['pdf'::text, 'html'::text, 'scanned_pdf'::text, 'unknown'::text, 'offline'::text])));
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_state_code_check CHECK (((state_code = upper(state_code)) AND ((length(state_code) >= 2) AND (length(state_code) <= 3))));
ALTER TABLE public.institution_sources ADD CONSTRAINT institution_sources_regulatory_status_check CHECK (((regulatory_status IS NULL) OR (regulatory_status = ANY (ARRAY['active'::text, 'inactive'::text]))));
ALTER TABLE public.institution_sources ADD CONSTRAINT institution_sources_rescue_status_check CHECK (((rescue_status IS NULL) OR (rescue_status = ANY (ARRAY['pending'::text, 'rescued'::text, 'dead'::text, 'needs_human'::text, 'retry_after'::text]))));
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_email_check CHECK (((email = lower(email)) AND (length(email) <= 320) AND (POSITION(('@'::text) IN (email)) > 1)));
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_lifecycle_check CHECK ((((invitation_status = 'pending'::text) AND (accepted_at IS NULL) AND (accepted_by_user_id IS NULL) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL)) OR ((invitation_status = 'accepted'::text) AND (accepted_at IS NOT NULL) AND (accepted_by_user_id IS NOT NULL) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL)) OR ((invitation_status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND (accepted_at IS NULL) AND (accepted_by_user_id IS NULL)) OR ((invitation_status = 'expired'::text) AND (accepted_at IS NULL) AND (accepted_by_user_id IS NULL) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL))));
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_role_check CHECK ((invited_role = ANY (ARRAY['admin'::text, 'analyst'::text, 'viewer'::text])));
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_status_check CHECK ((invitation_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])));
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_revocation_check CHECK ((((membership_status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL)) OR ((membership_status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL))));
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_role_check CHECK ((membership_role = ANY (ARRAY['owner'::text, 'admin'::text, 'analyst'::text, 'viewer'::text])));
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_source_check CHECK ((source = ANY (ARRAY['claim'::text, 'manual_admin'::text, 'delegated'::text, 'import'::text])));
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_status_check CHECK ((membership_status = ANY (ARRAY['active'::text, 'revoked'::text])));
ALTER TABLE public.knox_overrides ADD CONSTRAINT knox_overrides_decision_check CHECK ((decision = ANY (ARRAY['confirm'::text, 'override'::text])));
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_nonnegative_check CHECK (((yield_count >= 0) AND (cost_microusd >= 0) AND (strategy_version >= 1)));
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['ok'::text, 'ok_partial'::text, 'unchanged'::text, 'invalid_url'::text, 'http_403'::text, 'http_404'::text, 'http_410'::text, 'http_429'::text, 'http_5xx'::text, 'http_other'::text, 'timeout'::text, 'network_error'::text, 'too_large'::text, 'blocked_bot'::text, 'js_required'::text, 'scanned_pdf'::text, 'empty'::text, 'parse_error'::text, 'unsupported_format'::text, 'wrong_document'::text, 'no_candidates'::text, 'low_yield'::text, 'evidence_mismatch'::text, 'rejected'::text, 'budget_blocked'::text])));
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_stage_check CHECK ((stage = ANY (ARRAY['discover'::text, 'fetch'::text, 'read'::text, 'extract'::text, 'verify'::text, 'publish'::text])));
ALTER TABLE public.pipeline_runs ADD CONSTRAINT pipeline_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'completed'::text, 'partial'::text, 'failed'::text, 'canceled'::text, 'cancelled'::text, 'timed_out'::text])));
ALTER TABLE public.pipeline_runs ADD CONSTRAINT pipeline_runs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['manual'::text, 'cron'::text, 'schedule'::text, 'admin'::text, 'api'::text, 'agent'::text])));
ALTER TABLE public.pipeline_steps ADD CONSTRAINT pipeline_steps_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text])));
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_issue_code_check CHECK ((issue_code = ANY (ARRAY['horizontal_overflow'::text, 'visible_error'::text, 'console_errors'::text, 'unlabeled_inputs'::text, 'not_found'::text])));
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_state_code_check CHECK (((state_code IS NULL) OR ((state_code = upper(state_code)) AND ((length(state_code) >= 2) AND (length(state_code) <= 3)))));
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_verified_status_check CHECK ((verified_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'dismissed'::text])));
ALTER TABLE public.public_discovery_observations ADD CONSTRAINT public_discovery_observations_console_counts_check CHECK (((console_error_count >= 0) AND (console_warning_count >= 0)));
ALTER TABLE public.public_discovery_observations ADD CONSTRAINT public_discovery_observations_state_code_check CHECK (((state_code IS NULL) OR ((state_code = upper(state_code)) AND ((length(state_code) >= 2) AND (length(state_code) <= 3)))));
ALTER TABLE public.public_discovery_observations ADD CONSTRAINT public_discovery_observations_viewport_check CHECK ((viewport = ANY (ARRAY['desktop'::text, 'mobile'::text])));
ALTER TABLE public.published_fee_records ADD CONSTRAINT published_fee_records_coverage_tier_check CHECK (((coverage_tier = ANY (ARRAY['strong'::text, 'provisional'::text, 'insufficient'::text])) OR (coverage_tier IS NULL)));
ALTER TABLE public.raw_fee_observations ADD CONSTRAINT raw_fee_observations_source_check CHECK ((source = ANY (ARRAY['magellan'::text, 'knox'::text, 'migration_v10'::text, 'manual_import'::text])));
ALTER TABLE public.registry_ingest_partitions ADD CONSTRAINT registry_ingest_partitions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'succeeded'::text, 'empty'::text, 'failed'::text])));
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_report_type_check CHECK ((report_type = ANY (ARRAY['national_index'::text, 'state_index'::text, 'peer_brief'::text, 'monthly_pulse'::text])));
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assembling'::text, 'rendering'::text, 'complete'::text, 'failed'::text, 'cancel_requested'::text, 'cancelled'::text])));
ALTER TABLE public.research_messages ADD CONSTRAINT research_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text])));
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_mode_check CHECK ((validation_mode = ANY (ARRAY['manual'::text, 'automation_guarded'::text])));
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_status_check CHECK ((queue_status = ANY (ARRAY['manual_validation_needed'::text, 'ready_when_automation_resumes'::text, 'queued'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text])));
ALTER TABLE public.verified_fee_observations ADD CONSTRAINT verified_fee_observations_review_status_check CHECK ((review_status = ANY (ARRAY['verified'::text, 'challenged'::text, 'rejected'::text, 'approved'::text])));
ALTER TABLE public.wave_runs ADD CONSTRAINT wave_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'failed'::text])));
ALTER TABLE public.wave_state_runs ADD CONSTRAINT wave_state_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'failed'::text, 'skipped'::text])));
CREATE INDEX agent_auth_log_2026_04_agent_event_id_idx ON public.agent_auth_log_2026_04 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_04_agent_name_created_at_idx ON public.agent_auth_log_2026_04 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_04_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_04 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_05_agent_event_id_idx ON public.agent_auth_log_2026_05 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_05_agent_name_created_at_idx ON public.agent_auth_log_2026_05 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_05_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_05 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_06_agent_event_id_idx ON public.agent_auth_log_2026_06 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_06_agent_name_created_at_idx ON public.agent_auth_log_2026_06 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_06_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_06 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_07_agent_event_id_idx ON public.agent_auth_log_2026_07 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_07_agent_name_created_at_idx ON public.agent_auth_log_2026_07 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_07_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_07 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_08_agent_event_id_idx ON public.agent_auth_log_2026_08 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_08_agent_name_created_at_idx ON public.agent_auth_log_2026_08 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_08_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_08 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_09_agent_event_id_idx ON public.agent_auth_log_2026_09 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_09_agent_name_created_at_idx ON public.agent_auth_log_2026_09 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_09_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_09 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_10_agent_event_id_idx ON public.agent_auth_log_2026_10 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_10_agent_name_created_at_idx ON public.agent_auth_log_2026_10 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_10_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_10 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_2026_11_agent_event_id_idx ON public.agent_auth_log_2026_11 USING btree (agent_event_id);
CREATE INDEX agent_auth_log_2026_11_agent_name_created_at_idx ON public.agent_auth_log_2026_11 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_2026_11_entity_entity_id_created_at_idx ON public.agent_auth_log_2026_11 USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_agent_time_idx ON ONLY public.agent_auth_log USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_default_agent_event_id_idx ON public.agent_auth_log_default USING btree (agent_event_id);
CREATE INDEX agent_auth_log_default_agent_name_created_at_idx ON public.agent_auth_log_default USING btree (agent_name, created_at DESC);
CREATE INDEX agent_auth_log_default_entity_entity_id_created_at_idx ON public.agent_auth_log_default USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_entity_idx ON ONLY public.agent_auth_log USING btree (entity, entity_id, created_at DESC);
CREATE INDEX agent_auth_log_event_idx ON ONLY public.agent_auth_log USING btree (agent_event_id);
CREATE INDEX agent_budgets_halted_idx ON public.agent_budgets USING btree (halted_at) WHERE (halted_at IS NOT NULL);
CREATE INDEX agent_events_2026_04_agent_name_created_at_idx ON public.agent_events_2026_04 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_04_correlation_id_idx ON public.agent_events_2026_04 USING btree (correlation_id);
CREATE INDEX agent_events_2026_04_entity_entity_id_idx ON public.agent_events_2026_04 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_04_is_shadow_idx ON public.agent_events_2026_04 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_04_parent_event_id_idx ON public.agent_events_2026_04 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_04_tool_name_status_idx ON public.agent_events_2026_04 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_05_agent_name_created_at_idx ON public.agent_events_2026_05 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_05_correlation_id_idx ON public.agent_events_2026_05 USING btree (correlation_id);
CREATE INDEX agent_events_2026_05_entity_entity_id_idx ON public.agent_events_2026_05 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_05_is_shadow_idx ON public.agent_events_2026_05 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_05_parent_event_id_idx ON public.agent_events_2026_05 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_05_tool_name_status_idx ON public.agent_events_2026_05 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_06_agent_name_created_at_idx ON public.agent_events_2026_06 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_06_correlation_id_idx ON public.agent_events_2026_06 USING btree (correlation_id);
CREATE INDEX agent_events_2026_06_entity_entity_id_idx ON public.agent_events_2026_06 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_06_is_shadow_idx ON public.agent_events_2026_06 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_06_parent_event_id_idx ON public.agent_events_2026_06 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_06_tool_name_status_idx ON public.agent_events_2026_06 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_07_agent_name_created_at_idx ON public.agent_events_2026_07 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_07_correlation_id_idx ON public.agent_events_2026_07 USING btree (correlation_id);
CREATE INDEX agent_events_2026_07_entity_entity_id_idx ON public.agent_events_2026_07 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_07_is_shadow_idx ON public.agent_events_2026_07 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_07_parent_event_id_idx ON public.agent_events_2026_07 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_07_tool_name_status_idx ON public.agent_events_2026_07 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_08_agent_name_created_at_idx ON public.agent_events_2026_08 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_08_correlation_id_idx ON public.agent_events_2026_08 USING btree (correlation_id);
CREATE INDEX agent_events_2026_08_entity_entity_id_idx ON public.agent_events_2026_08 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_08_is_shadow_idx ON public.agent_events_2026_08 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_08_parent_event_id_idx ON public.agent_events_2026_08 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_08_tool_name_status_idx ON public.agent_events_2026_08 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_09_agent_name_created_at_idx ON public.agent_events_2026_09 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_09_correlation_id_idx ON public.agent_events_2026_09 USING btree (correlation_id);
CREATE INDEX agent_events_2026_09_entity_entity_id_idx ON public.agent_events_2026_09 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_09_is_shadow_idx ON public.agent_events_2026_09 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_09_parent_event_id_idx ON public.agent_events_2026_09 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_09_tool_name_status_idx ON public.agent_events_2026_09 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_10_agent_name_created_at_idx ON public.agent_events_2026_10 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_10_correlation_id_idx ON public.agent_events_2026_10 USING btree (correlation_id);
CREATE INDEX agent_events_2026_10_entity_entity_id_idx ON public.agent_events_2026_10 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_10_is_shadow_idx ON public.agent_events_2026_10 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_10_parent_event_id_idx ON public.agent_events_2026_10 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_10_tool_name_status_idx ON public.agent_events_2026_10 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_2026_11_agent_name_created_at_idx ON public.agent_events_2026_11 USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_2026_11_correlation_id_idx ON public.agent_events_2026_11 USING btree (correlation_id);
CREATE INDEX agent_events_2026_11_entity_entity_id_idx ON public.agent_events_2026_11 USING btree (entity, entity_id);
CREATE INDEX agent_events_2026_11_is_shadow_idx ON public.agent_events_2026_11 USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_2026_11_parent_event_id_idx ON public.agent_events_2026_11 USING btree (parent_event_id);
CREATE INDEX agent_events_2026_11_tool_name_status_idx ON public.agent_events_2026_11 USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_agent_time_idx ON ONLY public.agent_events USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_correlation_idx ON ONLY public.agent_events USING btree (correlation_id);
CREATE INDEX agent_events_default_agent_name_created_at_idx ON public.agent_events_default USING btree (agent_name, created_at DESC);
CREATE INDEX agent_events_default_correlation_id_idx ON public.agent_events_default USING btree (correlation_id);
CREATE INDEX agent_events_default_entity_entity_id_idx ON public.agent_events_default USING btree (entity, entity_id);
CREATE INDEX agent_events_default_is_shadow_idx ON public.agent_events_default USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_events_default_parent_event_id_idx ON public.agent_events_default USING btree (parent_event_id);
CREATE INDEX agent_events_default_tool_name_status_idx ON public.agent_events_default USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_entity_idx ON ONLY public.agent_events USING btree (entity, entity_id);
CREATE INDEX agent_events_error_idx ON ONLY public.agent_events USING btree (tool_name, status) WHERE (status = 'error'::text);
CREATE INDEX agent_events_parent_idx ON ONLY public.agent_events USING btree (parent_event_id);
CREATE INDEX agent_events_shadow_idx ON ONLY public.agent_events USING btree (is_shadow) WHERE is_shadow;
CREATE INDEX agent_institution_run_results_run_idx ON public.agent_institution_run_results USING btree (agent_run_id);
CREATE INDEX agent_lessons_active_idx ON public.agent_lessons USING btree (agent_name) WHERE (superseded_by IS NULL);
CREATE INDEX agent_lessons_agent_idx ON public.agent_lessons USING btree (agent_name, created_at DESC);
CREATE INDEX agent_messages_accept_fee_verified_idx ON public.agent_messages USING btree (((payload ->> 'fee_verified_id'::text))) WHERE (intent = 'accept'::text);
CREATE INDEX agent_messages_correlation_idx ON public.agent_messages USING btree (correlation_id);
CREATE INDEX agent_messages_darwin_pending_idx ON public.agent_messages USING btree (recipient_agent, created_at) WHERE (responded_at IS NULL);
CREATE INDEX agent_messages_expires_idx ON public.agent_messages USING btree (expires_at) WHERE ((expires_at IS NOT NULL) AND (state = 'open'::text));
CREATE INDEX agent_messages_knox_reject_created_idx ON public.agent_messages USING btree (created_at DESC, message_id) WHERE ((sender_agent = 'knox'::text) AND (intent = 'reject'::text));
CREATE INDEX agent_messages_recipient_state_idx ON public.agent_messages USING btree (recipient_agent, state, created_at DESC);
CREATE INDEX agent_run_events_run_time_idx ON public.agent_run_events USING btree (agent_run_id, created_at DESC, id DESC);
CREATE INDEX agent_run_events_type_idx ON public.agent_run_events USING btree (event_type, created_at DESC);
CREATE INDEX agent_run_steps_agent_status_idx ON public.agent_run_steps USING btree (agent_name, status, queued_at DESC);
CREATE INDEX agent_run_steps_run_sequence_idx ON public.agent_run_steps USING btree (agent_run_id, sequence);
CREATE UNIQUE INDEX agent_runs_active_idempotency_idx ON public.agent_runs USING btree (idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'running'::text, 'cancel_requested'::text])));
CREATE INDEX agent_runs_agent_started_idx ON public.agent_runs USING btree (agent_name, started_at DESC);
CREATE INDEX agent_runs_budget_policy_idx ON public.agent_runs USING btree (budget_policy_id, started_at DESC) WHERE (budget_policy_id IS NOT NULL);
CREATE INDEX agent_runs_correlation_idx ON public.agent_runs USING btree (correlation_id);
CREATE INDEX agent_runs_status_started_idx ON public.agent_runs USING btree (status, started_at DESC);
CREATE INDEX agent_source_texts_institution_updated_idx ON public.agent_source_texts USING btree (institution_id, updated_at DESC);
CREATE INDEX agent_source_texts_run_idx ON public.agent_source_texts USING btree (agent_run_id);
CREATE INDEX agent_source_texts_status_idx ON public.agent_source_texts USING btree (status, updated_at DESC);
CREATE INDEX agent_state_lanes_due_idx ON public.agent_state_lanes USING btree (next_run_after, priority_score DESC, state_code, lease_expires_at NULLS FIRST);
CREATE INDEX agent_state_lanes_last_run_idx ON public.agent_state_lanes USING btree (last_run_at DESC NULLS LAST);
CREATE INDEX agent_url_discovery_attempts_result_idx ON public.agent_url_discovery_attempts USING btree (result, attempted_at DESC);
CREATE INDEX ai_api_usage_agent_created_idx ON public.ai_api_usage_events USING btree (agent_name, created_at DESC);
CREATE INDEX ai_api_usage_agent_run_idx ON public.ai_api_usage_events USING btree (agent_run_id, created_at DESC) WHERE (agent_run_id IS NOT NULL);
CREATE INDEX ai_api_usage_budget_policy_idx ON public.ai_api_usage_events USING btree (budget_policy_id, created_at DESC) WHERE (budget_policy_id IS NOT NULL);
CREATE INDEX ai_api_usage_created_idx ON public.ai_api_usage_events USING btree (created_at DESC);
CREATE INDEX ai_api_usage_failures_idx ON public.ai_api_usage_events USING btree (created_at DESC) WHERE (status = ANY (ARRAY['failed'::text, 'blocked'::text]));
CREATE INDEX ai_api_usage_provider_created_idx ON public.ai_api_usage_events USING btree (provider, created_at DESC);
CREATE INDEX ai_api_usage_route_created_idx ON public.ai_api_usage_events USING btree (route_id, created_at DESC) WHERE (route_id IS NOT NULL);
CREATE INDEX ai_api_usage_user_created_idx ON public.ai_api_usage_events USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);
CREATE INDEX api_budget_policies_agent_idx ON public.api_budget_policies USING btree (agent_name) WHERE (agent_name IS NOT NULL);
CREATE INDEX api_budget_policies_route_idx ON public.api_budget_policies USING btree (route_id) WHERE (route_id IS NOT NULL);
CREATE INDEX api_budget_policies_scope_idx ON public.api_budget_policies USING btree (scope, enabled, updated_at DESC);
CREATE INDEX api_budget_windows_active_idx ON public.api_budget_windows USING btree (policy_id, window_start DESC, window_end DESC);
CREATE INDEX api_budget_windows_key_idx ON public.api_budget_windows USING btree (window_key, window_start DESC);
CREATE INDEX api_rate_limit_events_route_window_idx ON public.api_rate_limit_events USING btree (route_id, window_start DESC);
CREATE INDEX api_rate_limit_events_subject_idx ON public.api_rate_limit_events USING btree (subject_type, subject_key, window_start DESC);
CREATE INDEX api_route_audit_events_created_idx ON public.api_route_audit_events USING btree (created_at DESC);
CREATE INDEX api_route_audit_events_outcome_idx ON public.api_route_audit_events USING btree (outcome, created_at DESC) WHERE (outcome = ANY (ARRAY['blocked'::text, 'rate_limited'::text, 'unauthorized'::text, 'error'::text]));
CREATE INDEX api_route_audit_events_route_created_idx ON public.api_route_audit_events USING btree (route_id, created_at DESC);
CREATE INDEX api_route_audit_events_user_idx ON public.api_route_audit_events USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);
CREATE INDEX automation_control_audit_created_idx ON public.automation_control_audit USING btree (created_at DESC);
CREATE INDEX canary_runs_agent_version_idx ON public.canary_runs USING btree (agent_name, corpus_version, started_at DESC);
CREATE UNIQUE INDEX canary_runs_baseline_idx ON public.canary_runs USING btree (agent_name, corpus_version) WHERE is_baseline;
CREATE INDEX community_fee_submission_events_submission_idx ON public.community_fee_submission_events USING btree (submission_id, created_at DESC);
CREATE INDEX community_fee_submission_events_type_idx ON public.community_fee_submission_events USING btree (event_type, created_at DESC);
CREATE INDEX community_fee_submissions_institution_idx ON public.community_fee_submissions USING btree (institution_id, created_at DESC);
CREATE INDEX community_fee_submissions_resolution_idx ON public.community_fee_submissions USING btree (resolution, created_at DESC);
CREATE INDEX community_fee_submissions_reviewed_idx ON public.community_fee_submissions USING btree (review_status, reviewed_at DESC NULLS LAST);
CREATE INDEX community_fee_submissions_status_idx ON public.community_fee_submissions USING btree (review_status, created_at DESC);
CREATE INDEX consumer_guide_revisions_agent_run_idx ON public.consumer_guide_revisions USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);
CREATE INDEX consumer_guide_revisions_guide_idx ON public.consumer_guide_revisions USING btree (guide_id, created_at DESC);
CREATE INDEX consumer_guide_sections_guide_position_idx ON public.consumer_guide_sections USING btree (guide_id, "position");
CREATE INDEX consumer_guides_agent_run_idx ON public.consumer_guides USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);
CREATE INDEX consumer_guides_audience_tier_idx ON public.consumer_guides USING btree (audience, access_tier, featured);
CREATE INDEX consumer_guides_primary_category_idx ON public.consumer_guides USING btree (primary_category);
CREATE INDEX consumer_guides_related_categories_idx ON public.consumer_guides USING gin (related_categories);
CREATE INDEX consumer_guides_review_queue_idx ON public.consumer_guides USING btree (status, updated_at DESC) WHERE (status = ANY (ARRAY['draft'::text, 'in_review'::text, 'regulatory_review'::text]));
CREATE INDEX consumer_guides_stale_idx ON public.consumer_guides USING btree (stale_since DESC) WHERE (stale_since IS NOT NULL);
CREATE INDEX consumer_guides_status_published_idx ON public.consumer_guides USING btree (status, published_at DESC NULLS LAST);
CREATE INDEX fee_change_records_detected_category_idx ON public.fee_change_records USING btree (detected_at DESC, fee_category);
CREATE INDEX hamilton_digest_runs_status_idx ON public.hamilton_digest_runs USING btree (status, started_at DESC) WHERE (status <> 'success'::text);
CREATE INDEX hamilton_digest_runs_sub_idx ON public.hamilton_digest_runs USING btree (subscription_id, started_at DESC);
CREATE INDEX hamilton_digest_subs_due_idx ON public.hamilton_digest_subscriptions USING btree (next_due_at) WHERE (active = true);
CREATE INDEX hamilton_digest_subs_user_idx ON public.hamilton_digest_subscriptions USING btree (user_id);
CREATE INDEX historical_fee_observation_archive_canonical_key_idx ON public.historical_fee_observation_archive USING btree (canonical_fee_key) WHERE (canonical_fee_key IS NOT NULL);
CREATE INDEX historical_fee_observation_archive_cat_amt_idx ON public.historical_fee_observation_archive USING btree (fee_category, amount, institution_id) WHERE ((review_status <> 'rejected'::text) AND (fee_category IS NOT NULL) AND (amount IS NOT NULL));
CREATE INDEX historical_fee_observation_archive_category_idx ON public.historical_fee_observation_archive USING btree (fee_category, review_status);
CREATE INDEX historical_fee_observation_archive_institution_review_idx ON public.historical_fee_observation_archive USING btree (institution_id, review_status);
CREATE INDEX historical_fee_observation_archive_institution_status_idx ON public.historical_fee_observation_archive USING btree (institution_id, review_status, fee_category, amount);
CREATE INDEX historical_fee_observation_archive_review_idx ON public.historical_fee_observation_archive USING btree (review_status);
CREATE INDEX historical_fee_observation_archive_review_queue_idx ON public.historical_fee_observation_archive USING btree (review_status, created_at) WHERE (review_status = ANY (ARRAY['pending'::text, 'staged'::text, 'flagged'::text]));
CREATE INDEX historical_fee_observation_archive_source_document_idx ON public.historical_fee_observation_archive USING btree (source_document_id);
CREATE INDEX idx_articles_published ON public.articles USING btree (published_at);
CREATE INDEX idx_articles_slug ON public.articles USING btree (slug);
CREATE INDEX idx_articles_status ON public.articles USING btree (status);
CREATE INDEX idx_articles_type ON public.articles USING btree (article_type, fee_category);
CREATE INDEX idx_beige_book_district ON public.fed_beige_book USING btree (fed_district, release_date);
CREATE INDEX idx_beige_themes_category ON public.beige_book_themes USING btree (theme_category);
CREATE INDEX idx_beige_themes_district ON public.beige_book_themes USING btree (fed_district, release_code);
CREATE INDEX idx_census_tracts_state ON public.census_tracts USING btree (state_fips, year);
CREATE INDEX idx_classification_cache_key ON public.classification_cache USING btree (canonical_fee_key) WHERE (canonical_fee_key IS NOT NULL);
CREATE INDEX idx_classification_cache_low_conf ON public.classification_cache USING btree (confidence) WHERE (confidence < (0.90)::double precision);
CREATE INDEX idx_classification_history_fee ON public.classification_history USING btree (fee_verified_id, changed_at DESC);
CREATE INDEX idx_classification_history_old_new ON public.classification_history USING btree (old_canonical_key, new_canonical_key);
CREATE INDEX idx_demographics_geo ON public.demographics USING btree (geo_type, state_fips, year);
CREATE INDEX idx_ext_intel_category ON public.external_intelligence USING btree (category);
CREATE INDEX idx_ext_intel_search ON public.external_intelligence USING gin (search_vector);
CREATE INDEX idx_ext_intel_source_date ON public.external_intelligence USING btree (source_date DESC);
CREATE INDEX idx_ext_intel_tags ON public.external_intelligence USING gin (tags);
CREATE INDEX idx_fed_content_district ON public.fed_content USING btree (fed_district, published_at);
CREATE INDEX idx_fed_content_type ON public.fed_content USING btree (content_type);
CREATE INDEX idx_fed_indicators_series ON public.fed_economic_indicators USING btree (series_id, observation_date);
CREATE INDEX idx_fee_reviews_date ON public.fee_reviews USING btree (created_at DESC);
CREATE INDEX idx_hamilton_alert_signal ON public.hamilton_priority_alerts USING btree (signal_id);
CREATE INDEX idx_hamilton_alert_user ON public.hamilton_priority_alerts USING btree (user_id, created_at DESC);
CREATE INDEX idx_hamilton_analysis_inst ON public.hamilton_saved_analyses USING btree (institution_id);
CREATE INDEX idx_hamilton_analysis_user ON public.hamilton_saved_analyses USING btree (user_id, updated_at DESC);
CREATE INDEX idx_hamilton_conv_user ON public.hamilton_conversations USING btree (user_id, updated_at DESC);
CREATE INDEX idx_hamilton_msg_conv ON public.hamilton_messages USING btree (conversation_id, created_at);
CREATE INDEX idx_hamilton_msg_user ON public.hamilton_messages USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_hamilton_refresh_job_completions_user ON public.hamilton_refresh_job_completions USING btree (user_id, completed_at DESC);
CREATE INDEX idx_hamilton_refresh_jobs_scope ON public.hamilton_refresh_jobs USING btree (institution_id, status, priority DESC, created_at DESC);
CREATE INDEX idx_hamilton_refresh_jobs_signal ON public.hamilton_refresh_jobs USING btree (source_signal_id);
CREATE INDEX idx_hamilton_refresh_jobs_type ON public.hamilton_refresh_jobs USING btree (job_type, status, created_at DESC);
CREATE INDEX idx_hamilton_report_peer_set ON public.hamilton_reports USING btree (user_id, peer_set_id, created_at DESC) WHERE (peer_set_id IS NOT NULL);
CREATE INDEX idx_hamilton_report_policy_baseline ON public.hamilton_reports USING btree (evidence_policy, peer_baseline_source, created_at DESC);
CREATE INDEX idx_hamilton_report_scenario ON public.hamilton_reports USING btree (scenario_id);
CREATE INDEX idx_hamilton_report_status ON public.hamilton_reports USING btree (status, created_at DESC);
CREATE INDEX idx_hamilton_report_user ON public.hamilton_reports USING btree (user_id, created_at DESC);
CREATE INDEX idx_hamilton_scenario_inst ON public.hamilton_scenarios USING btree (institution_id);
CREATE INDEX idx_hamilton_scenario_policy_baseline ON public.hamilton_scenarios USING btree (evidence_policy, peer_baseline_source, updated_at DESC);
CREATE INDEX idx_hamilton_scenario_user ON public.hamilton_scenarios USING btree (user_id, updated_at DESC);
CREATE INDEX idx_hamilton_scenarios_peer_set ON public.hamilton_scenarios USING btree (user_id, peer_set_id) WHERE (peer_set_id IS NOT NULL);
CREATE INDEX idx_hamilton_signal_inst ON public.hamilton_signals USING btree (institution_id, created_at DESC);
CREATE INDEX idx_hamilton_signal_type ON public.hamilton_signals USING btree (signal_type);
CREATE INDEX idx_hamilton_watchlist_user ON public.hamilton_watchlists USING btree (user_id);
CREATE INDEX idx_hamilton_workspace_selected_institution ON public.hamilton_workspace_contexts USING btree (selected_institution_id);
CREATE INDEX idx_jobs_queue_pending ON public.jobs USING btree (queue, priority DESC, id) WHERE (status = 'pending'::text);
CREATE INDEX idx_market_concentration_msa ON public.market_concentration USING btree (msa_code, year);
CREATE UNIQUE INDEX idx_org_members_email ON public.org_members USING btree (email);
CREATE INDEX idx_pipeline_runs_created ON public.pipeline_runs USING btree (created_at DESC);
CREATE INDEX idx_pipeline_steps_run ON public.pipeline_steps USING btree (run_id, seq);
CREATE INDEX idx_reg_articles_published ON public.reg_articles USING btree (published_at DESC);
CREATE INDEX idx_research_articles_slug ON public.research_articles USING btree (slug);
CREATE INDEX idx_research_articles_status ON public.research_articles USING btree (status);
CREATE INDEX idx_research_conv_user ON public.research_conversations USING btree (user_id);
CREATE INDEX idx_research_msg_conv ON public.research_messages USING btree (conversation_id);
CREATE INDEX idx_research_usage_ip_date ON public.research_usage USING btree (ip_address, created_at);
CREATE INDEX idx_research_usage_user_date ON public.research_usage USING btree (user_id, created_at);
CREATE INDEX idx_stripe_events_type ON public.stripe_events USING btree (event_type);
CREATE INDEX idx_sub_peer_groups_org ON public.saved_subscriber_peer_groups USING btree (organization_id);
CREATE INDEX idx_usage_anon ON public.usage_events USING btree (anonymous_id, event_type, created_at);
CREATE INDEX idx_usage_org_type ON public.usage_events USING btree (organization_id, event_type, created_at);
CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);
CREATE UNIQUE INDEX idx_users_stripe_customer ON public.users USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);
CREATE INDEX institution_analysis_results_institution_type_idx ON public.institution_analysis_results USING btree (institution_id, analysis_type);
CREATE INDEX institution_branch_deposits_cert_year_idx ON public.institution_branch_deposits USING btree (cert, year);
CREATE INDEX institution_branch_deposits_msa_year_idx ON public.institution_branch_deposits USING btree (msa_code, year);
CREATE INDEX institution_claim_events_claim_idx ON public.institution_claim_events USING btree (claim_id, created_at DESC);
CREATE INDEX institution_claim_events_type_idx ON public.institution_claim_events USING btree (event_type, created_at DESC);
CREATE INDEX institution_claims_claimant_idx ON public.institution_claims USING btree (claimant_user_id, updated_at DESC);
CREATE INDEX institution_claims_institution_idx ON public.institution_claims USING btree (institution_id, created_at DESC);
CREATE UNIQUE INDEX institution_claims_one_open_per_user_institution_idx ON public.institution_claims USING btree (institution_id, claimant_user_id) WHERE (review_status = ANY (ARRAY['pending'::text, 'needs_info'::text]));
CREATE INDEX institution_claims_status_idx ON public.institution_claims USING btree (review_status, created_at DESC);
CREATE INDEX institution_complaint_records_institution_idx ON public.institution_complaint_records USING btree (institution_id);
CREATE INDEX institution_dossiers_next_try_idx ON public.institution_dossiers USING btree (next_try_recommendation) WHERE (next_try_recommendation IS NOT NULL);
CREATE INDEX institution_dossiers_outcome_idx ON public.institution_dossiers USING btree (last_outcome, updated_at DESC);
CREATE INDEX institution_dossiers_updated_by_agent_idx ON public.institution_dossiers USING btree (updated_by_agent, updated_at DESC);
CREATE INDEX institution_fee_alert_subscriptions_active_institution_idx ON public.institution_fee_alert_subscriptions USING btree (institution_id) WHERE is_active;
CREATE INDEX institution_fee_alert_subscriptions_user_active_idx ON public.institution_fee_alert_subscriptions USING btree (user_id) WHERE (is_active = true);
CREATE INDEX institution_fee_snapshot_records_institution_category_idx ON public.institution_fee_snapshot_records USING btree (institution_id, fee_category);
CREATE INDEX institution_filings_cik_filed_idx ON public.institution_filings USING btree (cik, filed_at DESC);
CREATE INDEX institution_filings_institution_idx ON public.institution_filings USING btree (institution_id, filed_at DESC);
CREATE INDEX institution_financial_records_cert_idx ON public.institution_financial_records USING btree (source_cert_number);
CREATE INDEX institution_financial_records_institution_report_idx ON public.institution_financial_records USING btree (institution_id, report_date);
CREATE INDEX institution_financial_records_report_source_idx ON public.institution_financial_records USING btree (report_date, source);
CREATE UNIQUE INDEX institution_financial_records_unmatched_source_idx ON public.institution_financial_records USING btree (source_cert_number, report_date, source) WHERE (institution_id IS NULL);
CREATE INDEX institution_identity_links_institution_idx ON public.institution_identity_links USING btree (institution_id, link_type);
CREATE INDEX institution_source_corrections_institution_idx ON public.institution_source_corrections USING btree (institution_id, created_at DESC);
CREATE INDEX institution_source_corrections_type_idx ON public.institution_source_corrections USING btree (correction_type, created_at DESC);
CREATE INDEX institution_source_profiles_backlog_idx ON public.institution_source_profiles USING btree (state_code, source_kind, read_strategy) WHERE ((source_kind = ANY (ARRAY['unknown'::text, 'scanned_pdf'::text])) OR (read_strategy = ANY (ARRAY['ocr'::text, 'manual_review'::text, 'browser_render'::text])));
CREATE INDEX institution_source_profiles_failure_idx ON public.institution_source_profiles USING btree (state_code, consecutive_failures DESC, last_failure_at DESC NULLS LAST) WHERE (consecutive_failures > 0);
CREATE INDEX institution_source_profiles_state_idx ON public.institution_source_profiles USING btree (state_code, updated_at DESC);
CREATE INDEX institution_sources_admin_eligible_idx ON public.institution_sources USING btree (id) INCLUDE (fee_schedule_url) WHERE ((status = 'active'::text) AND (COALESCE(document_type, ''::text) <> ALL (ARRAY['offline'::text, 'no_website'::text])));
CREATE INDEX institution_sources_charter_tier_idx ON public.institution_sources USING btree (charter_type, asset_size_tier);
CREATE INDEX institution_sources_failure_idx ON public.institution_sources USING btree (failure_reason) WHERE (failure_reason IS NOT NULL);
CREATE INDEX institution_sources_fee_url_idx ON public.institution_sources USING btree (fee_schedule_url) WHERE (fee_schedule_url IS NOT NULL);
CREATE INDEX institution_sources_holding_company_idx ON public.institution_sources USING btree (holding_company_rssd) WHERE (holding_company_rssd IS NOT NULL);
CREATE INDEX institution_sources_lei_idx ON public.institution_sources USING btree (lei) WHERE (lei IS NOT NULL);
CREATE INDEX institution_sources_ncua_idx ON public.institution_sources USING btree (ncua_charter_id) WHERE (ncua_charter_id IS NOT NULL);
CREATE INDEX institution_sources_platform_idx ON public.institution_sources USING btree (cms_platform);
CREATE INDEX institution_sources_rescue_pending_idx ON public.institution_sources USING btree (last_rescue_attempt_at NULLS FIRST) WHERE ((rescue_status = ANY (ARRAY['pending'::text, 'retry_after'::text])) OR (rescue_status IS NULL));
CREATE UNIQUE INDEX institution_sources_routing_idx ON public.institution_sources USING btree (routing_number) WHERE (routing_number IS NOT NULL);
CREATE UNIQUE INDEX institution_sources_rssd_idx ON public.institution_sources USING btree (rssd_id) WHERE (rssd_id IS NOT NULL);
CREATE INDEX institution_sources_sec_cik_idx ON public.institution_sources USING btree (sec_cik) WHERE (sec_cik IS NOT NULL);
CREATE INDEX institution_sources_state_tier_idx ON public.institution_sources USING btree (state_code, asset_size_tier);
CREATE INDEX institution_sources_with_fee_url_idx ON public.institution_sources USING btree (charter_type, asset_size_tier, fed_district, state_code) WHERE (fee_schedule_url IS NOT NULL);
CREATE INDEX institution_workspace_invitations_email_pending_idx ON public.institution_workspace_invitations USING btree (email, expires_at) WHERE (invitation_status = 'pending'::text);
CREATE INDEX institution_workspace_invitations_institution_idx ON public.institution_workspace_invitations USING btree (institution_id, invitation_status, created_at DESC);
CREATE INDEX institution_workspace_invitations_invited_by_idx ON public.institution_workspace_invitations USING btree (invited_by_user_id, created_at DESC);
CREATE UNIQUE INDEX institution_workspace_invitations_one_pending_idx ON public.institution_workspace_invitations USING btree (institution_id, email) WHERE (invitation_status = 'pending'::text);
CREATE INDEX institution_workspace_memberships_claim_idx ON public.institution_workspace_memberships USING btree (claim_id) WHERE (claim_id IS NOT NULL);
CREATE INDEX institution_workspace_memberships_institution_idx ON public.institution_workspace_memberships USING btree (institution_id, membership_status, granted_at DESC);
CREATE UNIQUE INDEX institution_workspace_memberships_one_active_idx ON public.institution_workspace_memberships USING btree (institution_id, user_id) WHERE (membership_status = 'active'::text);
CREATE INDEX institution_workspace_memberships_user_idx ON public.institution_workspace_memberships USING btree (user_id, membership_status, granted_at DESC);
CREATE INDEX knox_overrides_fee_verified_idx ON public.knox_overrides USING btree (fee_verified_id) WHERE (fee_verified_id IS NOT NULL);
CREATE UNIQUE INDEX knox_overrides_rejection_msg_unique ON public.knox_overrides USING btree (rejection_msg_id);
CREATE INDEX knox_overrides_reviewer_time_idx ON public.knox_overrides USING btree (reviewer_id, created_at DESC);
CREATE INDEX leads_lower_email_idx ON public.leads USING btree (lower(email));
CREATE INDEX pipeline_attempts_input_idx ON public.pipeline_attempts USING btree (input_fingerprint, strategy, strategy_version);
CREATE INDEX pipeline_attempts_institution_stage_idx ON public.pipeline_attempts USING btree (institution_id, stage, created_at DESC);
CREATE INDEX pipeline_attempts_run_idx ON public.pipeline_attempts USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);
CREATE INDEX public_discovery_findings_observation_idx ON public.public_discovery_findings USING btree (observation_id);
CREATE INDEX public_discovery_findings_state_code_idx ON public.public_discovery_findings USING btree (state_code, issue_code, verified_status, created_at DESC);
CREATE INDEX public_discovery_observations_run_idx ON public.public_discovery_observations USING btree (agent_run_id, observed_at DESC);
CREATE INDEX public_discovery_observations_state_route_idx ON public.public_discovery_observations USING btree (state_code, route_template, observed_at DESC);
CREATE INDEX published_fee_record_rollback_log_batch_idx ON public.published_fee_record_rollback_log USING btree (batch_id, created_at DESC);
CREATE UNIQUE INDEX published_fee_records_agentic_live_lineage_dedup_idx ON public.published_fee_records USING btree (lineage_ref) WHERE ((rolled_back_at IS NULL) AND (batch_id ~~ 'agentic-run-%'::text));
CREATE INDEX published_fee_records_batch_idx ON public.published_fee_records USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX published_fee_records_canonical_institution_idx ON public.published_fee_records USING btree (canonical_fee_key, institution_id);
CREATE INDEX published_fee_records_institution_time_idx ON public.published_fee_records USING btree (institution_id, published_at DESC);
CREATE INDEX published_fee_records_lineage_idx ON public.published_fee_records USING btree (lineage_ref);
CREATE INDEX published_fee_records_live_idx ON public.published_fee_records USING btree (published_at DESC) WHERE (rolled_back_at IS NULL);
CREATE INDEX published_fee_records_live_institution_idx ON public.published_fee_records USING btree (institution_id) WHERE (rolled_back_at IS NULL);
CREATE INDEX raw_fee_observations_agent_event_idx ON public.raw_fee_observations USING btree (agent_event_id);
CREATE UNIQUE INDEX raw_fee_observations_backfill_dedup_idx ON public.raw_fee_observations USING btree (source, source_document_id, fee_name) WHERE (source = 'migration_v10'::text);
CREATE INDEX raw_fee_observations_institution_time_idx ON public.raw_fee_observations USING btree (institution_id, created_at DESC);
CREATE UNIQUE INDEX raw_fee_observations_knox_agentic_dedup_idx ON public.raw_fee_observations USING btree (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric)) WHERE ((source = 'knox'::text) AND (source_document_id IS NOT NULL));
CREATE INDEX raw_fee_observations_lineage_missing_idx ON public.raw_fee_observations USING btree (institution_id) WHERE (outlier_flags ? 'lineage_missing'::text);
CREATE INDEX raw_fee_observations_source_idx ON public.raw_fee_observations USING btree (source, created_at DESC);
CREATE INDEX registry_ingest_partitions_due_idx ON public.registry_ingest_partitions USING btree (source, next_attempt_after);
CREATE INDEX report_jobs_status_created_at_idx ON public.report_jobs USING btree (status, created_at);
CREATE INDEX shadow_outputs_event_idx ON public.shadow_outputs USING btree (agent_event_id) WHERE (agent_event_id IS NOT NULL);
CREATE INDEX shadow_outputs_run_idx ON public.shadow_outputs USING btree (shadow_run_id, created_at DESC);
CREATE INDEX source_documents_crawled_at_idx ON public.source_documents USING btree (crawled_at DESC, institution_id);
CREATE UNIQUE INDEX source_documents_institution_content_unique_idx ON public.source_documents USING btree (institution_id, content_hash) WHERE ((status = 'success'::text) AND (content_hash IS NOT NULL) AND (duplicate_of_id IS NULL));
CREATE INDEX source_documents_institution_crawled_at_idx ON public.source_documents USING btree (institution_id, crawled_at DESC);
CREATE INDEX source_documents_institution_hash_idx ON public.source_documents USING btree (institution_id, content_hash) WHERE (content_hash IS NOT NULL);
CREATE INDEX source_documents_r2_key_idx ON public.source_documents USING btree (document_r2_key) WHERE (document_r2_key IS NOT NULL);
CREATE INDEX source_validation_queue_institution_idx ON public.source_validation_queue USING btree (institution_id, created_at DESC);
CREATE INDEX source_validation_queue_status_idx ON public.source_validation_queue USING btree (queue_status, priority, created_at DESC);
CREATE UNIQUE INDEX source_validation_queue_submission_unique_idx ON public.source_validation_queue USING btree (submission_id) WHERE (submission_id IS NOT NULL);
CREATE INDEX verified_fee_observations_canonical_institution_idx ON public.verified_fee_observations USING btree (canonical_fee_key, institution_id);
CREATE UNIQUE INDEX verified_fee_observations_darwin_agentic_dedup_idx ON public.verified_fee_observations USING btree (fee_raw_id) WHERE (outlier_flags ? 'agentic_darwin_verified'::text);
CREATE INDEX verified_fee_observations_institution_active_idx ON public.verified_fee_observations USING btree (institution_id) WHERE (review_status <> 'rejected'::text);
CREATE INDEX verified_fee_observations_raw_idx ON public.verified_fee_observations USING btree (fee_raw_id);
CREATE INDEX verified_fee_observations_status_idx ON public.verified_fee_observations USING btree (review_status, created_at DESC);
CREATE INDEX wave_runs_campaign_id_idx ON public.wave_runs USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
CREATE INDEX wave_runs_status_created_at_idx ON public.wave_runs USING btree (status, created_at);
CREATE INDEX wave_state_runs_wave_status_idx ON public.wave_state_runs USING btree (wave_run_id, status);
ALTER TABLE public.agent_budgets ADD CONSTRAINT agent_budgets_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name) ON DELETE CASCADE;
ALTER TABLE public.agent_health_rollup ADD CONSTRAINT agent_health_rollup_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.agent_institution_run_results ADD CONSTRAINT agent_institution_run_results_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id);
ALTER TABLE public.agent_lessons ADD CONSTRAINT agent_lessons_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.agent_lessons ADD CONSTRAINT agent_lessons_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES agent_lessons(lesson_id);
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES agent_messages(message_id);
ALTER TABLE public.agent_registry ADD CONSTRAINT agent_registry_parent_agent_fkey FOREIGN KEY (parent_agent) REFERENCES agent_registry(agent_name);
ALTER TABLE public.agent_run_events ADD CONSTRAINT agent_run_events_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;
ALTER TABLE public.agent_run_events ADD CONSTRAINT agent_run_events_step_id_fkey FOREIGN KEY (step_id) REFERENCES agent_run_steps(id) ON DELETE SET NULL;
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_budget_policy_id_fkey FOREIGN KEY (budget_policy_id) REFERENCES api_budget_policies(id) ON DELETE SET NULL;
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.agent_source_texts ADD CONSTRAINT agent_source_texts_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE;
ALTER TABLE public.agent_state_lanes ADD CONSTRAINT agent_state_lanes_last_agent_run_id_fkey FOREIGN KEY (last_agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_budget_policy_id_fkey FOREIGN KEY (budget_policy_id) REFERENCES api_budget_policies(id) ON DELETE SET NULL;
ALTER TABLE public.ai_api_usage_events ADD CONSTRAINT ai_api_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.alert_preferences ADD CONSTRAINT alert_preferences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE public.api_budget_windows ADD CONSTRAINT api_budget_windows_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES api_budget_policies(id) ON DELETE CASCADE;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_budget_policy_id_fkey FOREIGN KEY (budget_policy_id) REFERENCES api_budget_policies(id) ON DELETE SET NULL;
ALTER TABLE public.api_route_audit_events ADD CONSTRAINT api_route_audit_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.canary_runs ADD CONSTRAINT canary_runs_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.canary_runs ADD CONSTRAINT canary_runs_baseline_run_id_fkey FOREIGN KEY (baseline_run_id) REFERENCES canary_runs(run_id);
ALTER TABLE public.classification_history ADD CONSTRAINT classification_history_fee_verified_id_fkey FOREIGN KEY (fee_verified_id) REFERENCES verified_fee_observations(fee_verified_id) ON DELETE CASCADE;
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.community_fee_submission_events ADD CONSTRAINT community_fee_submission_events_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES community_fee_submissions(id) ON DELETE CASCADE;
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.community_fee_submissions ADD CONSTRAINT community_fee_submissions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.consumer_guide_revisions ADD CONSTRAINT consumer_guide_revisions_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.consumer_guide_revisions ADD CONSTRAINT consumer_guide_revisions_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES consumer_guides(id) ON DELETE CASCADE;
ALTER TABLE public.consumer_guide_sections ADD CONSTRAINT consumer_guide_sections_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES consumer_guides(id) ON DELETE CASCADE;
ALTER TABLE public.consumer_guides ADD CONSTRAINT consumer_guides_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.fee_change_records ADD CONSTRAINT fee_change_records_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.fee_reviews ADD CONSTRAINT fee_reviews_fee_id_fkey FOREIGN KEY (fee_id) REFERENCES historical_fee_observation_archive(id);
ALTER TABLE public.fee_reviews ADD CONSTRAINT fee_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE public.hamilton_digest_runs ADD CONSTRAINT hamilton_digest_runs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES hamilton_digest_subscriptions(subscription_id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_digest_subscriptions ADD CONSTRAINT hamilton_digest_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_messages ADD CONSTRAINT hamilton_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hamilton_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_priority_alerts ADD CONSTRAINT hamilton_priority_alerts_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES hamilton_signals(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_refresh_job_completions ADD CONSTRAINT hamilton_refresh_job_completions_job_id_fkey FOREIGN KEY (job_id) REFERENCES hamilton_refresh_jobs(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_refresh_job_completions ADD CONSTRAINT hamilton_refresh_job_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.hamilton_refresh_jobs ADD CONSTRAINT hamilton_refresh_jobs_source_signal_id_fkey FOREIGN KEY (source_signal_id) REFERENCES hamilton_signals(id) ON DELETE CASCADE;
ALTER TABLE public.hamilton_reports ADD CONSTRAINT hamilton_reports_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES hamilton_scenarios(id) ON DELETE SET NULL;
ALTER TABLE public.hamilton_workspace_contexts ADD CONSTRAINT hamilton_workspace_contexts_selected_institution_id_fkey FOREIGN KEY (selected_institution_id) REFERENCES institution_sources(id) ON DELETE SET NULL;
ALTER TABLE public.hamilton_workspace_contexts ADD CONSTRAINT hamilton_workspace_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.historical_fee_observation_archive ADD CONSTRAINT historical_fee_observation_archive_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.historical_fee_observation_archive ADD CONSTRAINT historical_fee_observation_archive_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES source_documents(id);
ALTER TABLE public.institution_analysis_results ADD CONSTRAINT institution_analysis_results_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_branch_deposits ADD CONSTRAINT institution_branch_deposits_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_claim_events ADD CONSTRAINT institution_claim_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_claim_events ADD CONSTRAINT institution_claim_events_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES institution_claims(id) ON DELETE CASCADE;
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_claimant_user_id_fkey FOREIGN KEY (claimant_user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_claims ADD CONSTRAINT institution_claims_source_submission_id_fkey FOREIGN KEY (source_submission_id) REFERENCES community_fee_submissions(id) ON DELETE SET NULL;
ALTER TABLE public.institution_complaint_records ADD CONSTRAINT institution_complaint_records_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_dossiers ADD CONSTRAINT institution_dossiers_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_fee_alert_subscriptions ADD CONSTRAINT institution_fee_alert_subscriptions_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_fee_alert_subscriptions ADD CONSTRAINT institution_fee_alert_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE public.institution_fee_snapshot_records ADD CONSTRAINT institution_fee_snapshot_records_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_fee_snapshot_records ADD CONSTRAINT institution_fee_snapshot_records_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES source_documents(id);
ALTER TABLE public.institution_filings ADD CONSTRAINT institution_filings_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE SET NULL;
ALTER TABLE public.institution_financial_records ADD CONSTRAINT institution_financial_records_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.institution_identity_links ADD CONSTRAINT institution_identity_links_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_source_corrections ADD CONSTRAINT institution_source_corrections_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.institution_source_corrections ADD CONSTRAINT institution_source_corrections_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_last_successful_source_documen_fkey FOREIGN KEY (last_successful_source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL;
ALTER TABLE public.institution_source_profiles ADD CONSTRAINT institution_source_profiles_last_successful_text_id_fkey FOREIGN KEY (last_successful_text_id) REFERENCES agent_source_texts(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.institution_workspace_invitations ADD CONSTRAINT institution_workspace_invitations_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES institution_claims(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.institution_workspace_memberships ADD CONSTRAINT institution_workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.knox_overrides ADD CONSTRAINT knox_overrides_promoted_fee_published_id_fkey FOREIGN KEY (promoted_fee_published_id) REFERENCES published_fee_records(fee_published_id);
ALTER TABLE public.knox_overrides ADD CONSTRAINT knox_overrides_rejection_msg_id_fkey FOREIGN KEY (rejection_msg_id) REFERENCES agent_messages(message_id);
ALTER TABLE public.knox_overrides ADD CONSTRAINT knox_overrides_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id);
ALTER TABLE public.org_members ADD CONSTRAINT org_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.pipeline_attempts ADD CONSTRAINT pipeline_attempts_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL;
ALTER TABLE public.pipeline_steps ADD CONSTRAINT pipeline_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE;
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.public_discovery_findings ADD CONSTRAINT public_discovery_findings_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public_discovery_observations(id) ON DELETE CASCADE;
ALTER TABLE public.public_discovery_observations ADD CONSTRAINT public_discovery_observations_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.published_fee_records ADD CONSTRAINT published_fee_records_lineage_ref_fkey FOREIGN KEY (lineage_ref) REFERENCES verified_fee_observations(fee_verified_id);
ALTER TABLE public.published_reports ADD CONSTRAINT published_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES report_jobs(id);
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id);
ALTER TABLE public.research_messages ADD CONSTRAINT research_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES research_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.saved_subscriber_peer_groups ADD CONSTRAINT saved_subscriber_peer_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE public.shadow_outputs ADD CONSTRAINT shadow_outputs_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES agent_registry(agent_name);
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_duplicate_of_id_fkey FOREIGN KEY (duplicate_of_id) REFERENCES source_documents(id) ON DELETE SET NULL;
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id);
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_source_collection_run_id_fkey FOREIGN KEY (source_collection_run_id) REFERENCES source_collection_runs(id);
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institution_sources(id) ON DELETE CASCADE;
ALTER TABLE public.source_validation_queue ADD CONSTRAINT source_validation_queue_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES community_fee_submissions(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE public.verified_fee_observations ADD CONSTRAINT verified_fee_observations_fee_raw_id_fkey FOREIGN KEY (fee_raw_id) REFERENCES raw_fee_observations(fee_raw_id);
ALTER TABLE public.wave_state_runs ADD CONSTRAINT wave_state_runs_wave_run_id_fkey FOREIGN KEY (wave_run_id) REFERENCES wave_runs(id);CREATE OR REPLACE FUNCTION public.log_classification_change()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF NEW.canonical_fee_key IS DISTINCT FROM OLD.canonical_fee_key
       OR NEW.variant_type IS DISTINCT FROM OLD.variant_type THEN
        INSERT INTO classification_history (
            fee_verified_id, old_canonical_key, new_canonical_key,
            old_variant_type, new_variant_type, agent_event_id, changed_by
        ) VALUES (
            NEW.fee_verified_id, OLD.canonical_fee_key, NEW.canonical_fee_key,
            OLD.variant_type, NEW.variant_type, NEW.verified_by_agent_event_id,
            COALESCE(current_setting('bfi.changed_by', true), current_user)
        );
    END IF;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_classification_history AFTER UPDATE ON public.verified_fee_observations FOR EACH ROW EXECUTE FUNCTION log_classification_change();
CREATE OR REPLACE VIEW public.published_fee_catalog AS  SELECT fp.fee_published_id AS id,
    fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fv.fee_raw_id, fp.institution_id,
    fp.fee_name, fp.amount, fp.frequency, fr.conditions,
    COALESCE(fp.extraction_confidence, fv.extraction_confidence, fr.extraction_confidence) AS extraction_confidence,
    'approved'::text AS review_status,
    COALESCE(fv.outlier_flags, '[]'::jsonb) AS validation_flags,
    fp.canonical_fee_key AS fee_category, fp.canonical_fee_key,
    NULL::text AS fee_family, NULL::text AS account_product_type, false AS is_fee_cap,
    fp.variant_type, fp.coverage_tier,
    COALESCE(fp.source_url, fv.source_url, fr.source_url) AS source_url, fr.source,
    COALESCE(fp.source_url, fv.source_url, fr.source_url) AS document_url,
    COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key) AS document_r2_key,
    fr.source_document_id,
    COALESCE(fp.agent_event_id, fr.agent_event_id) AS agent_event_id,
    COALESCE(fp.verified_by_agent_event_id, fv.verified_by_agent_event_id) AS verified_by_agent_event_id,
    fp.published_by_adversarial_event_id, fp.batch_id,
    fp.published_at AS created_at, fp.published_at AS updated_at
   FROM ((published_fee_records fp
     LEFT JOIN verified_fee_observations fv ON ((fv.fee_verified_id = fp.lineage_ref)))
     LEFT JOIN raw_fee_observations fr ON ((fr.fee_raw_id = fv.fee_raw_id)))
  WHERE (fp.rolled_back_at IS NULL);
INSERT INTO agent_registry (agent_name, display_name, description, role, parent_agent, state_code, is_active, lifecycle_state) VALUES
 ('atlas','Atlas','Root coordinator','orchestrator',NULL,NULL,true,'q1_validation'),
 ('magellan','Magellan','Discovery','data','atlas',NULL,true,'q2_high_confidence'),
 ('rosetta','Rosetta','Reader','data','atlas',NULL,true,'q1_validation'),
 ('knox','Knox','Extract','supervisor','atlas',NULL,true,'q1_validation'),
 ('darwin','Darwin','Verify','classifier','atlas',NULL,true,'q2_high_confidence'),
 ('hamilton','Hamilton','Publish','analyst','atlas',NULL,true,'q1_validation'),
 ('state_vt','State Agent VT',NULL,'state_agent','knox','VT',true,'q1_validation')
ON CONFLICT DO NOTHING;
INSERT INTO automation_control (control_key, enabled, reason, changed_by, changed_at, revision) VALUES
 ('global', true, 'e2e', 'e2e', now(), 1), ('pipeline', true, NULL, 'e2e', now(), 1)
ON CONFLICT DO NOTHING;
-- 20270106010000_magellan_find_team.sql
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
CREATE INDEX IF NOT EXISTS institution_additional_sources_status_idx
  ON public.institution_additional_sources (status, found_at);
-- 20270106020000_rosetta_table_rows.sql
ALTER TABLE public.agent_source_texts ADD COLUMN IF NOT EXISTS table_rows jsonb;
ALTER TABLE public.agent_source_texts ADD COLUMN IF NOT EXISTS reader text;
-- 20270106040000_state_memory.sql
CREATE TABLE IF NOT EXISTS public.state_memory (  state_code text PRIMARY KEY,
  expert_name text NOT NULL,
  expert_bio text NOT NULL,
  regulator jsonb DEFAULT '{}'::jsonb NOT NULL,
  platforms jsonb DEFAULT '[]'::jsonb NOT NULL,
  strategies jsonb DEFAULT '{}'::jsonb NOT NULL,
  peer_levels jsonb DEFAULT '[]'::jsonb NOT NULL,
  institution_count integer DEFAULT 0 NOT NULL,
  published_fee_count integer DEFAULT 0 NOT NULL,
  last_agent_run_id bigint,
  refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT state_memory_state_code_check CHECK (((state_code = upper(state_code)) AND ((length(state_code) >= 2) AND (length(state_code) <= 3))))
);

-- 20270106050000_answer_key_and_scoreboard.sql


CREATE TABLE IF NOT EXISTS public.answer_key_institutions (
  id                BIGSERIAL PRIMARY KEY,
  institution_id    BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  document_url      TEXT NOT NULL,
  document_type     TEXT NOT NULL DEFAULT 'html',
  content_hash      TEXT,
  status            TEXT NOT NULL DEFAULT 'prefilled',
  notes             TEXT,
  prefill_source    TEXT,
  prefilled_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT answer_key_institutions_institution_key UNIQUE (institution_id),
  CONSTRAINT answer_key_institutions_document_type_check
    CHECK (document_type IN ('html', 'text_pdf', 'scanned_pdf', 'js_page')),
  CONSTRAINT answer_key_institutions_status_check
    CHECK (status IN ('prefilled', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS public.answer_key_fees (
  id                          BIGSERIAL PRIMARY KEY,
  answer_key_institution_id   BIGINT NOT NULL REFERENCES public.answer_key_institutions(id) ON DELETE CASCADE,
  canonical_key               TEXT NOT NULL,
  amount                      NUMERIC(12,2),
  amount_kind                 TEXT NOT NULL DEFAULT 'fixed',
  frequency                   TEXT,
  conditions                  TEXT,
  source_line                 TEXT,
  uncertain                   BOOLEAN NOT NULL DEFAULT false,
  status                      TEXT NOT NULL DEFAULT 'prefilled',
  confirmed_by                TEXT,
  confirmed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT answer_key_fees_amount_kind_check
    CHECK (amount_kind IN ('fixed', 'free', 'varies')),
  CONSTRAINT answer_key_fees_amount_check
    CHECK ((amount_kind = 'fixed' AND amount IS NOT NULL AND amount >= 0)
        OR (amount_kind = 'free' AND (amount IS NULL OR amount = 0))
        OR (amount_kind = 'varies' AND amount IS NULL)),
  CONSTRAINT answer_key_fees_status_check
    CHECK (status IN ('prefilled', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS answer_key_fees_institution_idx
  ON public.answer_key_fees (answer_key_institution_id);

CREATE TABLE IF NOT EXISTS public.answer_key_score_runs (
  id                BIGSERIAL PRIMARY KEY,
  agent_run_id      BIGINT,
  scorer_version    INTEGER NOT NULL DEFAULT 1,
  banks_scored      INTEGER NOT NULL DEFAULT 0,
  fees_expected     INTEGER NOT NULL DEFAULT 0,
  precision         NUMERIC(6,4),
  recall            NUMERIC(6,4),
  by_stage          JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_category       JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_document_type  JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_bank           JSONB NOT NULL DEFAULT '[]'::jsonb,
  scored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS answer_key_score_runs_scored_at_idx
  ON public.answer_key_score_runs (scored_at DESC);

CREATE TABLE IF NOT EXISTS public.pipeline_scoreboard_snapshots (
  id                        BIGSERIAL PRIMARY KEY,
  snapshot_date             DATE NOT NULL,
  agent_run_id              BIGINT,
  coverage_rate             NUMERIC(6,4),
  coverage_numerator        INTEGER,
  coverage_denominator      INTEGER,
  right_document_rate       NUMERIC(6,4),
  right_document_numerator  INTEGER,
  right_document_denominator INTEGER,
  knox_yield                NUMERIC(8,4),
  knox_yield_fees           INTEGER,
  knox_yield_priced_lines   INTEGER,
  knox_yield_sample_size    INTEGER,
  depth_median_categories   NUMERIC(8,2),
  depth_live_institutions   INTEGER,
  accuracy_precision        NUMERIC(6,4),
  accuracy_recall           NUMERIC(6,4),
  accuracy_score_run_id     BIGINT,
  freshness_median_days     NUMERIC(10,2),
  freshness_live_fees       INTEGER,
  detail                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_scoreboard_snapshots_date_key UNIQUE (snapshot_date)
);

ALTER TABLE public.answer_key_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_key_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_key_score_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_scoreboard_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
  public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
      public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
      public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM authenticated;
  END IF;
END $$;

-- Rate columns and the rate catalog (migration 20270110000006_percentage_fees.sql).
ALTER TABLE public.raw_fee_observations
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

ALTER TABLE public.verified_fee_observations
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

ALTER TABLE public.published_fee_records
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

DO $$
DECLARE
  tier text;
BEGIN
  FOREACH tier IN ARRAY ARRAY['raw_fee_observations', 'verified_fee_observations', 'published_fee_records'] LOOP
    EXECUTE format(
      $sql$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        (amount_kind = 'flat' AND rate_percent IS NULL AND rate_min_amount IS NULL AND rate_max_amount IS NULL AND rate_basis IS NULL)
        OR (amount_kind = 'percent' AND amount IS NULL AND rate_percent > 0 AND rate_percent <= 100
            AND (rate_min_amount IS NULL OR rate_min_amount >= 0)
            AND (rate_max_amount IS NULL OR rate_max_amount >= COALESCE(rate_min_amount, 0))
            AND (rate_basis IS NULL OR rate_basis IN ('transaction', 'settlement', 'advance', 'balance_transferred', 'balance', 'loan_balance')))
      ) NOT VALID$sql$,
      tier,
      tier || '_amount_kind_check'
    );
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', tier, tier || '_amount_kind_check');
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.published_fee_rate_catalog
WITH (security_invoker = true)
AS
SELECT
  fp.fee_published_id AS id,
  fp.fee_published_id,
  fp.lineage_ref AS fee_verified_id,
  fv.fee_raw_id,
  fp.institution_id,
  fp.fee_name,
  fp.amount,
  fp.frequency,
  fr.conditions,
  COALESCE(fp.extraction_confidence, fv.extraction_confidence, fr.extraction_confidence) AS extraction_confidence,
  'approved'::text AS review_status,
  COALESCE(fv.outlier_flags, '[]'::jsonb) AS validation_flags,
  fp.canonical_fee_key AS fee_category,
  fp.canonical_fee_key,
  NULL::text AS fee_family,
  NULL::text AS account_product_type,
  false AS is_fee_cap,
  fp.variant_type,
  fp.coverage_tier,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS source_url,
  fr.source,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS document_url,
  COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key) AS document_r2_key,
  fr.source_document_id,
  COALESCE(fp.agent_event_id, fr.agent_event_id) AS agent_event_id,
  COALESCE(fp.verified_by_agent_event_id, fv.verified_by_agent_event_id) AS verified_by_agent_event_id,
  fp.published_by_adversarial_event_id,
  fp.batch_id,
  fp.published_at AS created_at,
  fp.published_at AS updated_at,
  fp.amount_kind,
  fp.rate_percent,
  fp.rate_min_amount,
  fp.rate_max_amount,
  fp.rate_basis
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.amount_kind = 'percent'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  );

-- Added 2026-10-07: the shared learning store (migration 20270110000001), read by Magellan's
-- link ledger and discovery since the 2026-10-04 snapshot.
CREATE TABLE IF NOT EXISTS public.pipeline_feedback (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The output being judged: the stage and strategy that produced it.
  about_stage        TEXT NOT NULL,
  about_strategy     TEXT,
  about_version      INTEGER,
  about_attempt_id   BIGINT,
  signal             TEXT NOT NULL,
  kind               TEXT NOT NULL,
  -- Who judged it, and with which check.
  reported_by        TEXT NOT NULL,
  check_name         TEXT,
  institution_id     BIGINT,
  source_document_id BIGINT,
  source_url         TEXT,
  fee_raw_id         BIGINT,
  fee_verified_id    BIGINT,
  fee_published_id   BIGINT,
  canonical_fee_key  TEXT,
  amount             NUMERIC,
  weight             NUMERIC NOT NULL DEFAULT 1,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id       BIGINT,
  dedupe_key         TEXT NOT NULL,
  CONSTRAINT pipeline_feedback_dedupe_key_key UNIQUE (dedupe_key),
  CONSTRAINT pipeline_feedback_about_stage_check
    CHECK (about_stage IN ('discover', 'fetch', 'read', 'extract', 'verify', 'publish')),
  CONSTRAINT pipeline_feedback_signal_check
    CHECK (signal IN ('wrong', 'right', 'missed', 'restored')),
  CONSTRAINT pipeline_feedback_reported_by_check
    CHECK (reported_by IN ('atlas', 'magellan', 'rosetta', 'knox', 'darwin', 'hamilton', 'human'))
);

CREATE INDEX IF NOT EXISTS pipeline_feedback_strategy_idx
  ON public.pipeline_feedback (about_stage, about_strategy, about_version, signal);
CREATE INDEX IF NOT EXISTS pipeline_feedback_institution_idx
  ON public.pipeline_feedback (institution_id);
CREATE INDEX IF NOT EXISTS pipeline_feedback_document_idx
  ON public.pipeline_feedback (source_document_id);
CREATE INDEX IF NOT EXISTS pipeline_feedback_url_idx
  ON public.pipeline_feedback (source_url);
CREATE INDEX IF NOT EXISTS pipeline_feedback_raw_idx
  ON public.pipeline_feedback (fee_raw_id) WHERE fee_raw_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_feedback_published_idx
  ON public.pipeline_feedback (fee_published_id) WHERE fee_published_id IS NOT NULL;
