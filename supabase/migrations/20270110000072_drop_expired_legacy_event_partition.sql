-- Atlas drops expired monthly partitions of the retired agent_events log whole (James, 2026-10-19),
-- instead of deleting their rows 20,000 at a time (row deletes leave dead tuples, return no disk).
-- Defines one narrowly scoped function; this file itself changes no data. Calling it drops a
-- partition and its rows, so the Atlas code that calls it waits for James's yes.

CREATE OR REPLACE FUNCTION public.drop_expired_legacy_event_partition(p_partition regclass, p_cutoff timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_schema TEXT;
    v_name   TEXT;
    v_bound  TEXT;
    v_upper  TIMESTAMPTZ;
BEGIN
    IF p_partition IS NULL OR p_cutoff IS NULL THEN
        RAISE EXCEPTION 'drop_expired_legacy_event_partition: partition and cutoff are required';
    END IF;

    -- Only a direct child of public.agent_events.
    SELECT n.nspname, c.relname, pg_get_expr(c.relpartbound, c.oid)
      INTO v_schema, v_name, v_bound
      FROM pg_inherits i
      JOIN pg_class c     ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.inhrelid = p_partition
       AND i.inhparent = 'public.agent_events'::regclass;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'drop_expired_legacy_event_partition: % is not a partition of public.agent_events', p_partition;
    END IF;

    -- Never the default partition, an archived table, or anything not named for one month.
    IF v_bound = 'DEFAULT' OR v_name LIKE '%\_archived' OR v_name !~ '^agent_events_[0-9]{4}_[0-9]{2}$' THEN
        RAISE EXCEPTION 'drop_expired_legacy_event_partition: % is not a monthly partition', v_name;
    END IF;

    -- Only a partition whose whole range ends before the cutoff.
    v_upper := substring(v_bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF v_upper IS NULL OR v_upper >= p_cutoff THEN
        RAISE EXCEPTION 'drop_expired_legacy_event_partition: % ends at %, not before the cutoff %', v_name, v_upper, p_cutoff;
    END IF;

    EXECUTE format('ALTER TABLE public.agent_events DETACH PARTITION %I.%I', v_schema, v_name);
    EXECUTE format('DROP TABLE %I.%I', v_schema, v_name);
END;
$function$;

COMMENT ON FUNCTION public.drop_expired_legacy_event_partition(regclass, timestamptz) IS
    'Atlas storage retention: detach and drop one monthly agent_events partition whose range ends before the cutoff. Refuses the default, *_archived and non-child tables.';

-- The app (DATABASE_URL as postgres) is the only caller; the Data API never needs it.
REVOKE EXECUTE ON FUNCTION public.drop_expired_legacy_event_partition(regclass, timestamptz) FROM PUBLIC;
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION public.drop_expired_legacy_event_partition(regclass, timestamptz) FROM %I', r);
        END IF;
    END LOOP;
END $$;
