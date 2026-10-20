-- #978 H03-T09: the published fee rows, and the source documents behind them, that each saved
-- Hamilton output used, so a later correction, reversal, hold or release finds every saved answer
-- and report that showed the changed fee (including one that used the institution only as a peer).
--
-- One row per saved output: `output_kind` and `output_id` name it (a hamilton_saved_analyses or
-- hamilton_reports id; 'briefing' is reserved for hamilton_briefing_snapshots, which records none
-- yet). `fee_published_ids` lists published_fee_records.fee_published_id values the output read;
-- `source_versions` holds {"fee", "doc", "hash"} per fee whose source document is known. The output
-- itself is never edited: its saved figures stay as they were, and a change only adds a notice.
--
-- Data: this file only adds one new, empty table and its index. It changes no existing row and
-- writes none. Saved outputs made before it have no row here; the app keeps matching those by the
-- institution they are about (the read used today), so nothing old is backfilled or rewritten.
-- Code tolerates the table being absent: saves skip the record and reads use that fallback.
-- Re-running is safe (IF NOT EXISTS throughout).
-- Rollback: DROP TABLE public.hamilton_saved_output_fee_refs; (outputs fall back to institution matching).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.hamilton_saved_output_fee_refs (
  output_kind        TEXT NOT NULL,
  output_id          TEXT NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fee_published_ids  BIGINT[] NOT NULL,
  source_versions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT hamilton_saved_output_fee_refs_pkey PRIMARY KEY (output_kind, output_id),
  CONSTRAINT hamilton_saved_output_fee_refs_kind_check CHECK (output_kind IN ('analysis', 'report', 'briefing')),
  CONSTRAINT hamilton_saved_output_fee_refs_ids_check CHECK (cardinality(fee_published_ids) BETWEEN 1 AND 2000),
  CONSTRAINT hamilton_saved_output_fee_refs_sources_check CHECK (jsonb_typeof(source_versions) = 'array')
);

-- "Which saved outputs used fee N": fee_published_ids && ARRAY[N] / @> ARRAY[N].
CREATE INDEX IF NOT EXISTS hamilton_saved_output_fee_refs_fees_idx
  ON public.hamilton_saved_output_fee_refs USING gin (fee_published_ids);

COMMENT ON TABLE public.hamilton_saved_output_fee_refs IS
  'Published fee rows and source documents each saved Hamilton output used (#978 H03-T09). Read to find saved outputs a fee correction affects; the outputs are never rewritten.';

ALTER TABLE public.hamilton_saved_output_fee_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hamilton_saved_output_fee_refs FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.hamilton_saved_output_fee_refs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.hamilton_saved_output_fee_refs FROM authenticated;
  END IF;
END $$;
