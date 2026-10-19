-- #2220: future exact normalized witnesses. Empty schema only; no backfill or replay.
-- Generated with `supabase migration new normalized_source_text_witnesses`, then
-- sequenced after the project's existing applied 20270110000066 migration.
SET lock_timeout = '5s';

CREATE TABLE public.agent_source_text_witnesses (
  artifact_id BIGINT NOT NULL,
  text_hash TEXT NOT NULL,
  source_document_id BIGINT NOT NULL,
  institution_id BIGINT NOT NULL,
  normalized_text TEXT NOT NULL,
  source_hash TEXT,
  source_url TEXT,
  document_type TEXT,
  reader TEXT,
  observed_agent_run_id BIGINT,
  observed_artifact_status TEXT NOT NULL,
  observed_artifact_created_at TIMESTAMPTZ,
  observed_artifact_updated_at TIMESTAMPTZ,
  capture_kind TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (artifact_id, text_hash),
  CONSTRAINT normalized_witness_owner_ids CHECK (artifact_id > 0 AND source_document_id > 0 AND institution_id > 0),
  CONSTRAINT normalized_witness_hash CHECK (text_hash ~ '^[a-f0-9]{64}$'
    AND text_hash = encode(sha256(convert_to(normalized_text, 'UTF8')), 'hex')),
  CONSTRAINT normalized_witness_nonempty CHECK (char_length(normalized_text) > 0),
  CONSTRAINT normalized_witness_capture_kind CHECK (capture_kind IN ('incoming', 'incumbent'))
);
-- Pin the existing current-text owner so the reviewed writer-role compatibility
-- does not depend on which administrative role executes this new migration.
ALTER TABLE public.agent_source_text_witnesses OWNER TO postgres;
-- Plain identity values deliberately have no cascading foreign keys: removing a
-- source, current artifact or run must never silently erase its retained witness.
ALTER TABLE public.agent_source_text_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_source_text_witnesses FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.agent_source_text_witnesses TO service_role;
CREATE POLICY normalized_witness_backend_select ON public.agent_source_text_witnesses
  FOR SELECT TO service_role USING (true);
CREATE POLICY normalized_witness_backend_insert ON public.agent_source_text_witnesses
  FOR INSERT TO service_role WITH CHECK (true);

-- Privilege revocation alone cannot prevent a table owner's ordinary
-- UPDATE/DELETE/TRUNCATE. This guard also covers that normal-write role model.
-- Complete current-writer role metadata is checked separately from deployed
-- client attribution; this migration does not claim that client's current_user.
-- An owner with DDL rights can disable/drop the guard; that administrator power
-- is outside this normal-DML immutability contract.
CREATE FUNCTION public.reject_normalized_witness_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'Normalized witnesses are append-only; captured evidence cannot be changed or removed'
    USING ERRCODE = '23514';
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_normalized_witness_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER normalized_witness_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.agent_source_text_witnesses
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_normalized_witness_mutation();

COMMENT ON TABLE public.agent_source_text_witnesses IS
  'Private exact normalized bytes retained prospectively by Rosetta (#2220). captured_at is actual retention time; observed metadata is not proof of the original extraction/read time or current bank applicability. No automatic purge or historical consumer authority.';
RESET lock_timeout;
