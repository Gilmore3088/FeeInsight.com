-- Evidence-first pilot layer (James, 2026-11-01: "Pilot-first new layer").
--
-- New tables only. For a pilot cohort of 10 institutions (5 banks, 5 credit unions), each fee is
-- held as an obligation with bitemporal versions (when the fee applies, and when we recorded it),
-- and every version points at the exact characters of a stored source text that state it. A
-- separate source-side inventory lists the fees a document states, read independently of the
-- obligations, so precision (obligations -> source) and recall (source -> obligations) are both
-- measured. Today's agents feed it; the live fee tables, catalog and site are untouched until the
-- pilot reaches 99.5% precision and 90% recall.
--
-- Lineage is enforced here, not by convention:
--   * an evidence segment must equal the exact characters of an append-only normalized witness
--     (agent_source_text_witnesses), checked on insert;
--   * every obligation version must cite at least one segment of the same institution, checked at
--     commit;
--   * the current versions of one obligation never overlap in effective time;
--   * segments, source fees and adjudications are append-only, and a version changes only once,
--     when a newer record supersedes it.
--
-- Data: creates empty tables, functions and triggers. Changes no existing row and locks no existing
-- table: a segment's witness is checked by trigger, not by a foreign key, so
-- agent_source_text_witnesses (append-only, so a checked witness never goes away) is left as it is.
-- No backfill. Writers: src/lib/data-store/evidence-pilot.ts only.

SET lock_timeout = '5s';

CREATE TABLE public.evidence_pilot_institutions (
  institution_id BIGINT PRIMARY KEY,
  cohort TEXT NOT NULL,
  reason TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT evidence_pilot_institution_id CHECK (institution_id > 0),
  CONSTRAINT evidence_pilot_cohort CHECK (cohort IN ('bank', 'credit_union')),
  CONSTRAINT evidence_pilot_reason CHECK (char_length(btrim(reason)) > 0)
);

CREATE TABLE public.evidence_segments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id BIGINT NOT NULL,
  source_document_id BIGINT NOT NULL,
  witness_artifact_id BIGINT NOT NULL,
  witness_text_hash TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  segment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT evidence_segment_span CHECK (char_start >= 0 AND char_end > char_start
    AND char_length(segment_text) = char_end - char_start),
  CONSTRAINT evidence_segment_unique UNIQUE (witness_artifact_id, witness_text_hash, char_start, char_end)
);
CREATE INDEX evidence_segments_institution ON public.evidence_segments (institution_id);

CREATE TABLE public.evidence_source_fees (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id BIGINT NOT NULL,
  evidence_segment_id BIGINT NOT NULL REFERENCES public.evidence_segments (id),
  canonical_key TEXT NOT NULL,
  audience TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  amount NUMERIC(12, 2),
  amount_kind TEXT NOT NULL,
  rate_percent NUMERIC(8, 4),
  method TEXT NOT NULL,
  agent_run_id BIGINT,
  -- Set when the document says the fee starts after it was captured ("effective December 1").
  valid_from DATE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT evidence_source_fee_audience CHECK (audience IN ('consumer', 'business')),
  CONSTRAINT evidence_source_fee_amount CHECK (
    (amount_kind = 'fixed' AND amount IS NOT NULL AND amount > 0 AND rate_percent IS NULL)
    OR (amount_kind = 'free' AND amount = 0 AND rate_percent IS NULL)
    OR (amount_kind = 'varies' AND amount IS NULL AND rate_percent IS NULL)
    OR (amount_kind = 'rate' AND amount IS NULL AND rate_percent IS NOT NULL AND rate_percent > 0)),
  CONSTRAINT evidence_source_fee_method CHECK (char_length(btrim(method)) > 0)
);
CREATE INDEX evidence_source_fees_institution ON public.evidence_source_fees (institution_id, canonical_key);

CREATE TABLE public.fee_obligations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id BIGINT NOT NULL,
  canonical_key TEXT NOT NULL,
  audience TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fee_obligation_audience CHECK (audience IN ('consumer', 'business')),
  CONSTRAINT fee_obligation_identity UNIQUE (institution_id, canonical_key, audience, variant)
);

CREATE TABLE public.fee_obligation_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obligation_id BIGINT NOT NULL REFERENCES public.fee_obligations (id),
  amount NUMERIC(12, 2),
  amount_kind TEXT NOT NULL,
  rate_percent NUMERIC(8, 4),
  frequency TEXT,
  conditions TEXT,
  -- Effective (valid) time: [valid_from, valid_to). valid_from_basis says whether the document
  -- stated the date, we only know when we first saw the document, or the version is the part of an
  -- older one that continues after a newer, closed range ends (carried_forward).
  valid_from DATE NOT NULL,
  valid_to DATE,
  valid_from_basis TEXT NOT NULL,
  -- System (transaction) time: [recorded_at, superseded_at).
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  superseded_at TIMESTAMPTZ,
  superseded_by BIGINT REFERENCES public.fee_obligation_versions (id),
  produced_by TEXT NOT NULL,
  agent_run_id BIGINT,
  CONSTRAINT fee_obligation_version_amount CHECK (
    (amount_kind = 'fixed' AND amount IS NOT NULL AND amount > 0 AND rate_percent IS NULL)
    OR (amount_kind = 'free' AND amount = 0 AND rate_percent IS NULL)
    OR (amount_kind = 'varies' AND amount IS NULL AND rate_percent IS NULL)
    OR (amount_kind = 'rate' AND amount IS NULL AND rate_percent IS NOT NULL AND rate_percent > 0)),
  CONSTRAINT fee_obligation_version_valid CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT fee_obligation_version_basis CHECK (valid_from_basis IN ('stated_effective_date', 'document_first_seen', 'carried_forward')),
  CONSTRAINT fee_obligation_version_superseded CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  CONSTRAINT fee_obligation_version_producer CHECK (char_length(btrim(produced_by)) > 0)
);
CREATE INDEX fee_obligation_versions_current ON public.fee_obligation_versions (obligation_id) WHERE superseded_at IS NULL;

CREATE TABLE public.fee_obligation_evidence (
  obligation_version_id BIGINT NOT NULL REFERENCES public.fee_obligation_versions (id),
  evidence_segment_id BIGINT NOT NULL REFERENCES public.evidence_segments (id),
  PRIMARY KEY (obligation_version_id, evidence_segment_id)
);

CREATE TABLE public.fee_adjudications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obligation_version_id BIGINT REFERENCES public.fee_obligation_versions (id),
  source_fee_id BIGINT REFERENCES public.evidence_source_fees (id),
  verdict TEXT NOT NULL,
  method TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  notes TEXT,
  agent_run_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fee_adjudication_subject CHECK (obligation_version_id IS NOT NULL OR source_fee_id IS NOT NULL),
  CONSTRAINT fee_adjudication_verdict CHECK (verdict IN
    ('match', 'amount_mismatch', 'category_mismatch', 'not_in_source', 'missing_from_obligations')),
  CONSTRAINT fee_adjudication_method CHECK (char_length(btrim(method)) > 0),
  CONSTRAINT fee_adjudication_reviewer CHECK (char_length(btrim(reviewer)) > 0)
);
CREATE INDEX fee_adjudications_version ON public.fee_adjudications (obligation_version_id);
CREATE INDEX fee_adjudications_source_fee ON public.fee_adjudications (source_fee_id);

-- A segment is the exact characters of its witness, for the witness's own document and institution.
CREATE FUNCTION public.check_evidence_segment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
DECLARE w RECORD;
BEGIN
  SELECT institution_id, source_document_id, normalized_text INTO w
    FROM public.agent_source_text_witnesses
   WHERE artifact_id = NEW.witness_artifact_id AND text_hash = NEW.witness_text_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence segment cites no stored witness' USING ERRCODE = '23503';
  END IF;
  IF w.institution_id <> NEW.institution_id OR w.source_document_id <> NEW.source_document_id THEN
    RAISE EXCEPTION 'Evidence segment names a different institution or document than its witness' USING ERRCODE = '23514';
  END IF;
  IF substr(w.normalized_text, NEW.char_start + 1, NEW.char_end - NEW.char_start) IS DISTINCT FROM NEW.segment_text THEN
    RAISE EXCEPTION 'Evidence segment text is not the witness text at that span' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER evidence_segment_exact BEFORE INSERT ON public.evidence_segments
  FOR EACH ROW EXECUTE FUNCTION public.check_evidence_segment();

-- A source fee belongs to the institution its segment does.
CREATE FUNCTION public.check_evidence_source_fee() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.evidence_segments s WHERE s.id = NEW.evidence_segment_id AND s.institution_id = NEW.institution_id) THEN
    RAISE EXCEPTION 'Source fee cites a segment of another institution' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER evidence_source_fee_owner BEFORE INSERT ON public.evidence_source_fees
  FOR EACH ROW EXECUTE FUNCTION public.check_evidence_source_fee();

-- Evidence links cite segments of the obligation's own institution.
CREATE FUNCTION public.check_fee_obligation_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.fee_obligation_versions v
      JOIN public.fee_obligations o ON o.id = v.obligation_id
      JOIN public.evidence_segments s ON s.id = NEW.evidence_segment_id
     WHERE v.id = NEW.obligation_version_id AND s.institution_id = o.institution_id) THEN
    RAISE EXCEPTION 'Obligation evidence cites a segment of another institution' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER fee_obligation_evidence_owner BEFORE INSERT ON public.fee_obligation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.check_fee_obligation_evidence();

-- At commit: every version cites evidence, and an obligation's current versions never overlap in
-- effective time.
CREATE FUNCTION public.check_fee_obligation_version() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM public.fee_obligation_versions WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fee_obligation_evidence e WHERE e.obligation_version_id = v.id) THEN
    RAISE EXCEPTION 'Obligation version % cites no evidence segment', v.id USING ERRCODE = '23514';
  END IF;
  IF v.superseded_at IS NULL AND EXISTS (
    SELECT 1 FROM public.fee_obligation_versions o
     WHERE o.obligation_id = v.obligation_id AND o.id <> v.id AND o.superseded_at IS NULL
       AND daterange(o.valid_from, o.valid_to, '[)') && daterange(v.valid_from, v.valid_to, '[)')) THEN
    RAISE EXCEPTION 'Obligation % has overlapping current versions', v.obligation_id USING ERRCODE = '23P01';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER fee_obligation_version_lineage AFTER INSERT OR UPDATE ON public.fee_obligation_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_fee_obligation_version();

-- A version changes once: when a newer record supersedes it. Nothing else about it ever changes.
CREATE FUNCTION public.guard_fee_obligation_version_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
    RAISE EXCEPTION 'Obligation versions are append-only; a version changes only when it is superseded' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fee_obligation_versions n
                  WHERE n.id = NEW.superseded_by AND n.id <> OLD.id
                    AND n.obligation_id = OLD.obligation_id AND n.recorded_at >= OLD.recorded_at) THEN
    RAISE EXCEPTION 'A version is superseded only by a newer version of the same obligation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER fee_obligation_version_append_only BEFORE UPDATE ON public.fee_obligation_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_fee_obligation_version_update();

-- An obligation's identity never changes: moving it would move every version and its evidence.
-- The store's upsert writes the same values back (for the row lock), which is allowed.
CREATE FUNCTION public.guard_fee_obligation_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $function$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'A fee obligation''s identity never changes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER fee_obligation_identity_fixed BEFORE UPDATE ON public.fee_obligations
  FOR EACH ROW EXECUTE FUNCTION public.guard_fee_obligation_update();

-- An adjudication pairs records of one institution.
CREATE FUNCTION public.check_fee_adjudication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NEW.obligation_version_id IS NOT NULL AND NEW.source_fee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fee_obligation_versions v
      JOIN public.fee_obligations o ON o.id = v.obligation_id
      JOIN public.evidence_source_fees f ON f.id = NEW.source_fee_id
     WHERE v.id = NEW.obligation_version_id AND f.institution_id = o.institution_id) THEN
    RAISE EXCEPTION 'An adjudication pairs a version and a source fee of different institutions' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER fee_adjudication_owner BEFORE INSERT ON public.fee_adjudications
  FOR EACH ROW EXECUTE FUNCTION public.check_fee_adjudication();

-- Segments, source fees, evidence links, adjudications and pilot membership are append-only;
-- obligations and versions are never deleted.
CREATE FUNCTION public.reject_evidence_pilot_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'Evidence pilot records are append-only' USING ERRCODE = '23514';
END;
$function$;
CREATE TRIGGER evidence_segments_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.evidence_segments
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER evidence_source_fees_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.evidence_source_fees
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER fee_obligation_evidence_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.fee_obligation_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER fee_adjudications_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.fee_adjudications
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER fee_obligation_versions_no_delete BEFORE DELETE OR TRUNCATE ON public.fee_obligation_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER fee_obligations_no_delete BEFORE DELETE OR TRUNCATE ON public.fee_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();
CREATE TRIGGER evidence_pilot_institutions_fixed BEFORE UPDATE OR DELETE OR TRUNCATE ON public.evidence_pilot_institutions
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_evidence_pilot_mutation();

-- Backend only, like the other agent tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_pilot_institutions', 'evidence_segments', 'evidence_source_fees', 'fee_obligations',
                           'fee_obligation_versions', 'fee_obligation_evidence', 'fee_adjudications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.check_evidence_segment(), public.check_evidence_source_fee(), public.check_fee_obligation_evidence(),
  public.check_fee_obligation_version(), public.guard_fee_obligation_version_update(), public.guard_fee_obligation_update(),
  public.check_fee_adjudication(), public.reject_evidence_pilot_mutation()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.fee_obligation_versions IS
  'Evidence-first pilot: bitemporal fee versions (valid_from/valid_to effective time; recorded_at/superseded_at system time), each citing exact source characters through fee_obligation_evidence. Not read by the live site.';

RESET lock_timeout;
