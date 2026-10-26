-- Additive storage support. No existing observations are rewritten by this migration.
-- Deploy the compatible readers first. Historical compaction is a separate run-ledger action.
SET LOCAL lock_timeout = '3s';
CREATE TABLE public.call_report_item_definitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('ffiec','ncua')),
  item_key text NOT NULL,
  item_code text NOT NULL,
  item_description text,
  schedule text,
  UNIQUE NULLS NOT DISTINCT (source,item_key,item_code,item_description,schedule)
);
ALTER TABLE public.call_report_item_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_report_item_definitions FROM PUBLIC,anon,authenticated;
ALTER TABLE public.institution_call_report_items
  ADD COLUMN metadata_definition_id bigint REFERENCES public.call_report_item_definitions(id);

-- The original public analytical contract, with historical and compact observations together.
CREATE VIEW public.call_report_item_facts WITH (security_invoker=true) AS
SELECT c.id,c.institution_id,c.source,c.report_date,c.item_code,c.item_key,
       CASE WHEN c.metadata_definition_id IS NULL THEN c.item_description ELSE d.item_description END AS item_description,
       CASE WHEN c.metadata_definition_id IS NULL THEN c.schedule ELSE d.schedule END AS schedule,
       c.value,c.unit,c.period_basis,c.source_url,c.agent_run_id,c.fetched_at
  FROM public.institution_call_report_items c
  LEFT JOIN public.call_report_item_definitions d ON d.id=c.metadata_definition_id;
REVOKE ALL ON public.call_report_item_facts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.upsert_call_report_item_batch(p_source text,p_date date,p_url text,p_run bigint,p_rows jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
DECLARE result bigint;
BEGIN
-- Acquire the writer lock before the archive lookup gets its statement snapshot.
LOCK TABLE public.institution_call_report_items IN ROW EXCLUSIVE MODE;
WITH r AS MATERIALIZED (
  SELECT x.*,ids.id AS institution_id FROM jsonb_to_recordset(p_rows) AS x(
    rssd text,charter text,item_key text,item_code text,item_description text,schedule text,
    value numeric,unit text,period_basis text)
  JOIN LATERAL (
    SELECT s.id FROM public.institution_sources s
     WHERE (p_source='ffiec' AND s.source='fdic' AND s.rssd_id=x.rssd)
        OR (p_source='ncua' AND s.source='ncua' AND (s.cert_number=x.charter OR s.ncua_charter_id=x.charter))
     ORDER BY s.id LIMIT 1
  ) ids ON true
  -- Small POR identity witnesses stay hot even when the financial detail is archived.
  WHERE x.item_key IN ('filing_fdic_cert','filing_last_updated') OR NOT EXISTS (SELECT 1 FROM public.public_data_cold_files archived
    WHERE archived.table_name='institution_call_report_items' AND archived.source=p_source
      AND archived.period=p_date::text AND archived.pruned_at IS NOT NULL)
), defs AS (
  INSERT INTO public.call_report_item_definitions(source,item_key,item_code,item_description,schedule)
  SELECT DISTINCT p_source,item_key,item_code,item_description,
    CASE WHEN p_source='ncua' THEN NULLIF(schedule,'') ELSE schedule END FROM r
  ON CONFLICT (source,item_key,item_code,item_description,schedule)
  DO UPDATE SET item_key=EXCLUDED.item_key
  RETURNING *
), written AS (
  INSERT INTO public.institution_call_report_items AS c
    (institution_id,source,report_date,item_key,item_code,value,unit,period_basis,source_url,agent_run_id,metadata_definition_id)
  SELECT r.institution_id,p_source,p_date,r.item_key,r.item_code,r.value,r.unit,r.period_basis,p_url,p_run,d.id
    FROM r JOIN defs d ON d.source=p_source AND d.item_key=r.item_key AND d.item_code=r.item_code
     AND d.item_description IS NOT DISTINCT FROM r.item_description
     AND d.schedule IS NOT DISTINCT FROM CASE WHEN p_source='ncua' THEN NULLIF(r.schedule,'') ELSE r.schedule END
  ON CONFLICT (institution_id,source,report_date,item_key) DO UPDATE SET
    item_code=EXCLUDED.item_code,value=EXCLUDED.value,unit=EXCLUDED.unit,period_basis=EXCLUDED.period_basis,
    source_url=EXCLUDED.source_url,agent_run_id=EXCLUDED.agent_run_id,fetched_at=now(),
    metadata_definition_id=EXCLUDED.metadata_definition_id,item_description=NULL,schedule=NULL
  WHERE ROW(c.item_code,c.value,c.unit,c.period_basis,c.source_url,c.metadata_definition_id)
    IS DISTINCT FROM ROW(EXCLUDED.item_code,EXCLUDED.value,EXCLUDED.unit,EXCLUDED.period_basis,EXCLUDED.source_url,EXCLUDED.metadata_definition_id)
  RETURNING 1
) SELECT count(*) INTO result FROM written;
RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.upsert_call_report_item_batch(text,date,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;

-- Bounded history conversion, invoked only from the authenticated run ledger after approval.
-- SKIP LOCKED rows are revisited on the next pass; callers reset after_id at end of a pass.
CREATE FUNCTION public.compact_call_report_item_metadata(p_after bigint,p_limit integer)
RETURNS TABLE(changed bigint,through_id bigint) LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
WITH selected AS MATERIALIZED (
  SELECT * FROM public.institution_call_report_items
   WHERE id>p_after AND metadata_definition_id IS NULL
   ORDER BY id LIMIT LEAST(GREATEST(p_limit,0),5000) FOR UPDATE SKIP LOCKED
), defs AS (
  INSERT INTO public.call_report_item_definitions(source,item_key,item_code,item_description,schedule)
  SELECT DISTINCT source,item_key,item_code,item_description,schedule FROM selected
  ON CONFLICT (source,item_key,item_code,item_description,schedule) DO UPDATE SET item_key=EXCLUDED.item_key
  RETURNING *
), written AS (
  UPDATE public.institution_call_report_items c
     SET metadata_definition_id=d.id,item_description=NULL,schedule=NULL
    FROM selected r JOIN defs d ON d.source=r.source AND d.item_key=r.item_key AND d.item_code=r.item_code
     AND d.item_description IS NOT DISTINCT FROM r.item_description AND d.schedule IS NOT DISTINCT FROM r.schedule
   WHERE c.id=r.id AND c.metadata_definition_id IS NULL RETURNING c.id
) SELECT (SELECT count(*) FROM written),(SELECT max(id) FROM selected);
$function$;
REVOKE ALL ON FUNCTION public.compact_call_report_item_metadata(bigint,integer) FROM PUBLIC,anon,authenticated;

-- Rollback counterpart: expand stored metadata before rolling the compatible readers back.
CREATE FUNCTION public.expand_call_report_item_metadata(p_after bigint,p_limit integer)
RETURNS TABLE(changed bigint,through_id bigint) LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
WITH selected AS MATERIALIZED (
  SELECT id,metadata_definition_id FROM public.institution_call_report_items
   WHERE id>p_after AND metadata_definition_id IS NOT NULL
   ORDER BY id LIMIT LEAST(GREATEST(p_limit,0),5000) FOR UPDATE SKIP LOCKED
), written AS (
  UPDATE public.institution_call_report_items c
     SET metadata_definition_id=NULL,item_description=d.item_description,schedule=d.schedule
    FROM selected r JOIN public.call_report_item_definitions d ON d.id=r.metadata_definition_id
   WHERE c.id=r.id AND c.metadata_definition_id=r.metadata_definition_id RETURNING c.id
) SELECT (SELECT count(*) FROM written),(SELECT max(id) FROM selected);
$function$;
REVOKE ALL ON FUNCTION public.expand_call_report_item_metadata(bigint,integer) FROM PUBLIC,anon,authenticated;

-- Large update-heavy tables currently wait for 20% dead tuples. Make freed pages reusable sooner.
ALTER TABLE public.institution_call_report_items SET (autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.02);
ALTER TABLE public.institution_financial_records SET (autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.02);
