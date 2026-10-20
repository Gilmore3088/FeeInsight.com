-- Pin search_path on the seven legacy functions that still run with the caller's search_path
-- (Supabase advisor 0011, DB review LOW-1). Waits for James's yes before merge.
-- Function config only: no body changes, no behaviour change, no row is inserted, updated or deleted.
-- None of these is SECURITY DEFINER or callable by anon/authenticated (20270101060000).
-- The other two of the nine, maintain_agent_events_partitions() and
-- maintain_agent_auth_log_partitions(), were pinned by 20270110000069.
-- Signatures match prod's pg_proc on 2026-10-20. IF EXISTS because a database built only from
-- migrations has no ext_intel_search_vector_update() (it was created outside migrations).

SET lock_timeout = '5s';

ALTER FUNCTION IF EXISTS public.agent_messages_notify()
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.ext_intel_search_vector_update()
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.lineage_graph(bigint)
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.log_classification_change()
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.promote_to_tier2(bigint, text, bytea, uuid, text, text, jsonb)
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.promote_to_tier3(bigint, uuid, text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.refresh_agent_health_rollup(timestamptz)
  SET search_path = public, pg_catalog;
