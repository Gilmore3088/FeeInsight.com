-- Legacy agent_events / agent_auth_log: RLS on every table, the partition maintainers keep it on,
-- and four leftover pg_cron jobs paused (definitions kept). Waits for James's yes before merge.
-- Schema and cron config only: no app row is inserted, updated or deleted.

SET lock_timeout = '5s';

-- 1. RLS, no policies: backend-only. postgres and service_role have BYPASSRLS, so the app
--    (DATABASE_URL as postgres) and cron (jobs run as postgres) keep full access; anon and
--    authenticated already have no grants, and now also see zero rows if one is ever added.
--    On prod (Oct 19) only the two parents and the 2026_10/2026_11 partitions lacked RLS; every
--    partition is covered so a database built from migrations ends in the same state.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT c.oid::regclass AS rel
          FROM pg_class c
         WHERE c.oid IN ('public.agent_events'::regclass, 'public.agent_auth_log'::regclass)
            OR c.oid IN (SELECT inhrelid FROM pg_inherits
                          WHERE inhparent IN ('public.agent_events'::regclass,
                                              'public.agent_auth_log'::regclass))
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
    END LOOP;
END $$;

-- 2. New partitions get RLS; search_path pinned (advisor 0011). Detach/rename behaviour unchanged.
CREATE OR REPLACE FUNCTION public.maintain_agent_events_partitions()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, pg_catalog
AS $function$
DECLARE
    next_month     DATE := (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE;
    after_month    DATE := (date_trunc('month', NOW()) + INTERVAL '2 months')::DATE;
    archive_cutoff DATE := (date_trunc('month', NOW()) - INTERVAL '18 months')::DATE;
    next_name      TEXT := 'agent_events_' || to_char(next_month, 'YYYY_MM');
    r              RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = next_name
                     AND relnamespace = 'public'::regnamespace) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.agent_events FOR VALUES FROM (%L) TO (%L)',
            next_name, next_month, after_month
        );
        RAISE NOTICE 'Created partition %', next_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', next_name);

    FOR r IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON c.oid = i.inhrelid
        JOIN pg_class p    ON p.oid = i.inhparent
        WHERE p.oid = 'public.agent_events'::regclass
          AND c.relname ~ '^agent_events_\d{4}_\d{2}$'
          AND to_date(substring(c.relname FROM '\d{4}_\d{2}$'), 'YYYY_MM') < archive_cutoff
    LOOP
        EXECUTE format('ALTER TABLE public.agent_events DETACH PARTITION public.%I', r.relname);
        EXECUTE format('ALTER TABLE public.%I RENAME TO %I', r.relname, r.relname || '_archived');
        RAISE NOTICE 'Archived partition %', r.relname;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.maintain_agent_auth_log_partitions()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, pg_catalog
AS $function$
DECLARE
    next_month     DATE := (date_trunc('month', NOW()) + INTERVAL '1 month')::DATE;
    after_month    DATE := (date_trunc('month', NOW()) + INTERVAL '2 months')::DATE;
    archive_cutoff DATE := (date_trunc('month', NOW()) - INTERVAL '18 months')::DATE;
    next_name      TEXT := 'agent_auth_log_' || to_char(next_month, 'YYYY_MM');
    r              RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = next_name
                     AND relnamespace = 'public'::regnamespace) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.agent_auth_log FOR VALUES FROM (%L) TO (%L)',
            next_name, next_month, after_month
        );
        RAISE NOTICE 'Created partition %', next_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', next_name);

    FOR r IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON c.oid = i.inhrelid
        JOIN pg_class p    ON p.oid = i.inhparent
        WHERE p.oid = 'public.agent_auth_log'::regclass
          AND c.relname ~ '^agent_auth_log_\d{4}_\d{2}$'
          AND to_date(substring(c.relname FROM '\d{4}_\d{2}$'), 'YYYY_MM') < archive_cutoff
    LOOP
        EXECUTE format('ALTER TABLE public.agent_auth_log DETACH PARTITION public.%I', r.relname);
        EXECUTE format('ALTER TABLE public.%I RENAME TO %I', r.relname, r.relname || '_archived');
        RAISE NOTICE 'Archived partition %', r.relname;
    END LOOP;
END;
$function$;

-- Cron runs these as postgres; the Data API never needs them.
REVOKE EXECUTE ON FUNCTION public.maintain_agent_events_partitions()   FROM service_role;
REVOKE EXECUTE ON FUNCTION public.maintain_agent_auth_log_partitions() FROM service_role;

-- 3. Pause the four leftover cron jobs by name (kept, not unscheduled; skip any that is absent).
DO $$
DECLARE
    j RECORD;
BEGIN
    IF to_regnamespace('cron') IS NULL THEN
        RETURN;
    END IF;
    FOR j IN
        SELECT jobid FROM cron.job
         WHERE jobname IN ('seed-discovery-queue', 'cleanup-old-jobs',
                           'agent-review-knox', 'agent-review-darwin')
    LOOP
        PERFORM cron.alter_job(j.jobid, active := false);
    END LOOP;
END $$;
