-- One priced line that names two fees ("Overdraft/NSF Fee | $30") is the bank's price for both.
-- Knox reads it as two candidates (v27 twin), but the raw dedupe key (document, lower(name),
-- amount, audience) has no category, so the second candidate met the first row and was dropped:
-- 101 live combined-name overdraft fees sat at banks with no NSF fee (Oct 19, 2026).
--
-- `line_share` names the extra fee a shared line carries ('twin:nsf', 'twin:overdraft'). Every
-- other row keeps '' and the key behaves exactly as before for it.
--
-- Schema only: no row changes. Adding a column with a constant default is metadata-only; the index
-- rebuild covers ~272k Knox rows (41 MB index).
ALTER TABLE public.raw_fee_observations
  ADD COLUMN IF NOT EXISTS line_share text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.raw_fee_observations.line_share IS
  'The second fee a shared priced line carries (twin:<category>); empty for every other row. Part of the Knox dedupe key.';

DROP INDEX IF EXISTS public.raw_fee_observations_knox_agentic_dedup_idx;
CREATE UNIQUE INDEX raw_fee_observations_knox_agentic_dedup_idx
  ON public.raw_fee_observations (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric), fee_audience, line_share)
  WHERE source = 'knox' AND source_document_id IS NOT NULL;
