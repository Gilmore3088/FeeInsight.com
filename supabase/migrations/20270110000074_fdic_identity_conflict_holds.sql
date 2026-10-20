-- #2266. Schema only; no backfill, identifier changes, queued runs or gate activation.
-- Every row is an unresolved, sticky FDIC identity veto and its first observation.
-- Later successful, missing, incomplete or older responses never clear this evidence.
-- A resolution protocol requires a separately reviewed release; none exists here.
CREATE TABLE public.institution_identity_holds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  source TEXT NOT NULL DEFAULT 'fdic' CHECK (source = 'fdic'),
  certificate TEXT NOT NULL CHECK (certificate ~ '^[0-9]+$'),
  -- Snapshot lineage, deliberately without cascading FKs: evidence survives retention
  -- and is also matched by certificate if an institution is subsequently re-created.
  institution_id BIGINT CHECK (institution_id > 0),
  reason TEXT NOT NULL CHECK (reason IN ('shared_lei', 'stored_lei_conflict', 'source_certificate_conflict')),
  stored_lei TEXT,
  implicated_leis TEXT[] NOT NULL CHECK (cardinality(implicated_leis) > 0),
  reported_leis TEXT[] NOT NULL CHECK (cardinality(reported_leis) > 0),
  owner_certificates TEXT[] NOT NULL CHECK (cardinality(owner_certificates) > 0),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  source_url TEXT NOT NULL,
  -- SHA-256 of canonical JSON raw records (a logical snapshot, not HTTP bytes).
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  parser_version INTEGER NOT NULL DEFAULT 1 CHECK (parser_version = 1),
  observed_at TIMESTAMPTZ NOT NULL,
  agent_run_id BIGINT NOT NULL CHECK (agent_run_id > 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX institution_identity_holds_certificate_idx ON public.institution_identity_holds (certificate);
CREATE INDEX institution_identity_holds_institution_idx ON public.institution_identity_holds (institution_id)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.institution_identity_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_identity_holds FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reject_identity_hold_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Identity holds are append-only; resolution requires a separately reviewed release';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_identity_hold_mutation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER institution_identity_holds_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.institution_identity_holds
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_identity_hold_mutation();

COMMENT ON TABLE public.institution_identity_holds IS
  'Unresolved FDIC identity conflicts. Immutable first-observation evidence; global institution/certificate/LEI veto. No automatic expiry or runtime resolution.';
