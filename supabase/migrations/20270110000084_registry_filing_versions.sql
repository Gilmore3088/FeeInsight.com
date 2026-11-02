-- Filing versions: an amended FDIC or NCUA quarter no longer overwrites the as-filed value (#2613, R9).
-- Schema only: one new empty table, its indexes, RLS, one pure SQL function, and the compact call-item
-- writer re-created with one added step. Changes no existing data and backfills nothing: versions
-- start from the first amendment seen after this ships.
--
-- The registry loaders (Hoovie: fdic-financials, ncua-financials, ffiec-call-detail, ncua-extras)
-- already update a filing row only when a reported value differs from the stored one. In the same
-- statement they now add one row here holding the values that changed, as [as stored before, as
-- refetched], with the run that last wrote the old value and the run that replaced it. Readers keep
-- reading the main tables (the latest version); a re-read of a saved claim asks this table whether
-- the quarter it cited was amended since.
--
-- Size: only changed reported values are kept (no raw_json, no unchanged columns), so a row is a few
-- hundred bytes. The table has its own budget in src/lib/agents/hoovie/size-budgets.ts.
-- RLS on with no policies: service-role reads only, like the other registry tables.
CREATE TABLE IF NOT EXISTS public.registry_filing_versions (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  -- The id of the row in table_name that was amended (it keeps its id; only its values change).
  row_id BIGINT NOT NULL,
  institution_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  report_date DATE NOT NULL,
  -- institution_call_report_items.item_key; null for institution_financial_records.
  item_key TEXT,
  -- {"column": [value before, value after], ...} for each reported value that changed.
  changed JSONB NOT NULL,
  prior_fetched_at TIMESTAMPTZ,
  prior_agent_run_id BIGINT,
  superseded_by_run_id BIGINT,
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT registry_filing_versions_table_check
    CHECK (table_name IN ('institution_financial_records', 'institution_call_report_items')),
  CONSTRAINT registry_filing_versions_changed_check
    CHECK (jsonb_typeof(changed) = 'object' AND changed <> '{}'::jsonb)
);

CREATE INDEX IF NOT EXISTS registry_filing_versions_quarter_idx
  ON public.registry_filing_versions (institution_id, report_date, superseded_at);
CREATE INDEX IF NOT EXISTS registry_filing_versions_row_idx
  ON public.registry_filing_versions (table_name, row_id);

ALTER TABLE public.registry_filing_versions ENABLE ROW LEVEL SECURITY;

-- The reported values that differ between two rows, as {"key": [before, after]}; '{}' when none.
-- Pure: compares JSON values, so 100 and 100.0 are equal and a null only equals a null.
CREATE OR REPLACE FUNCTION public.registry_changed_values(prior JSONB, next JSONB, keys TEXT[])
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_array(prior -> k, next -> k)), '{}'::jsonb)
    FROM unnest(keys) AS k
   WHERE COALESCE(prior -> k, 'null'::jsonb) IS DISTINCT FROM COALESCE(next -> k, 'null'::jsonb)
$$;

-- The compact call-item writer (20270110000079) keeps its signature and behaviour, and now also adds
-- a versions row for each line whose value, unit or period basis changed. Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.upsert_call_report_item_batch(p_source text,p_date date,p_url text,p_run bigint,p_rows jsonb)
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
), versioned AS (
  -- #2613: an amended line keeps the value, unit and period basis it replaces. Same statement
  -- snapshot as the upsert below, so this reads each row as it stood before it.
  INSERT INTO public.registry_filing_versions
    (table_name,row_id,institution_id,source,report_date,item_key,changed,prior_fetched_at,prior_agent_run_id,superseded_by_run_id)
  SELECT 'institution_call_report_items',c.id,c.institution_id,c.source,c.report_date,c.item_key,d.changed,
         c.fetched_at,c.agent_run_id,p_run
    FROM r JOIN public.institution_call_report_items c
      ON c.institution_id=r.institution_id AND c.source=p_source AND c.report_date=p_date AND c.item_key=r.item_key
    CROSS JOIN LATERAL (
      SELECT public.registry_changed_values(to_jsonb(c),to_jsonb(r),ARRAY['value','unit','period_basis']) AS changed
    ) d
   WHERE d.changed<>'{}'::jsonb
  RETURNING 1
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
