-- Repair double-encoded JSON and let Darwin log rejections.
--
-- Cause: postgres.js JSON-encodes json/jsonb parameters, so `${JSON.stringify(x)}::jsonb`
-- stored a JSON *string* ("[\"needs_darwin_verification\", ...]") instead of an array
-- or object. SQL JSON operators never matched it: Darwin's
-- `outlier_flags ? 'needs_darwin_verification'` selected zero Knox rows, so no
-- agent-extracted fee was ever verified or published. The connection now passes
-- JSON text through unchanged (src/lib/data-store/connection.ts); this migration
-- unwraps the values already stored.
--
-- Deterministic and idempotent: only values whose jsonb type is 'string' AND whose
-- text parses as a JSON object or array are rewritten to that object or array.
-- Ordinary JSON strings are left alone. Backup and archive tables are skipped.
--
-- Also adds the 'rejected' attempt outcome, which Darwin records for rows it will not
-- verify, so they are never re-selected with the same rules.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.try_jsonb_container(value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  parsed JSONB;
BEGIN
  IF value IS NULL OR value !~ '^\s*[\[{]' THEN
    RETURN NULL;
  END IF;
  parsed := value::jsonb;
  IF jsonb_typeof(parsed) IN ('object', 'array') THEN
    RETURN parsed;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  target RECORD;
  repaired BIGINT;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND a.atttypid = 'jsonb'::regtype
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND c.relname NOT LIKE 'backup\_%'
       AND c.relname NOT LIKE '%\_backup\_%'
       AND c.relname NOT LIKE 'historical\_%'
     ORDER BY c.relname, a.attname
  LOOP
    EXECUTE format(
      'UPDATE public.%1$I
          SET %2$I = pg_temp.try_jsonb_container(%2$I #>> ''{}'')
        WHERE jsonb_typeof(%2$I) = ''string''
          AND pg_temp.try_jsonb_container(%2$I #>> ''{}'') IS NOT NULL',
      target.table_name,
      target.column_name
    );
    GET DIAGNOSTICS repaired = ROW_COUNT;
    IF repaired > 0 THEN
      RAISE NOTICE 'repaired %.%: % rows', target.table_name, target.column_name, repaired;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.pipeline_attempts
  DROP CONSTRAINT IF EXISTS pipeline_attempts_outcome_check;
ALTER TABLE public.pipeline_attempts
  ADD CONSTRAINT pipeline_attempts_outcome_check
  CHECK (outcome IN (
    'ok',
    'ok_partial',
    'unchanged',
    'invalid_url',
    'http_403',
    'http_404',
    'http_410',
    'http_429',
    'http_5xx',
    'http_other',
    'timeout',
    'network_error',
    'too_large',
    'blocked_bot',
    'js_required',
    'scanned_pdf',
    'empty',
    'parse_error',
    'unsupported_format',
    'wrong_document',
    'no_candidates',
    'low_yield',
    'evidence_mismatch',
    'rejected',
    'budget_blocked'
  ));

COMMIT;
