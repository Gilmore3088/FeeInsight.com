-- Percentage fees can carry a rate (Hamilton publish thread with Knox, 6 Oct 2026).
--
-- A foreign transaction fee is "1.1% of the transaction", not a dollar amount, so Knox held
-- every such line as knox_review:percentage (492 rows; 347 banks have a foreign transaction
-- fee only as a rate). These columns let a fee state a rate instead of an amount, on all
-- three fee tiers, so the rate can be verified, published and shown as "1.1% of the
-- transaction".
--
--   amount_kind      'flat' (amount is the fee) or 'percent' (rate_percent is the fee)
--   rate_percent     1.1 means 1.1%; required for a percent fee, absent for a flat one
--   rate_min_amount  dollar minimum stated with the rate ("3%, $10 minimum")
--   rate_max_amount  dollar maximum stated with the rate
--   rate_basis       what the rate is a share of
--
-- A percent fee keeps amount NULL, so no dollar median, envelope or comparison ever mixes a
-- rate in. Which fee categories may publish a rate is code (Darwin), not a constraint.
--
-- Data change: none. Every existing row becomes amount_kind 'flat' with no rate, which is
-- what it already is. Columns with a constant default are added without rewriting tables.
-- The checks are added NOT VALID and then validated, so writers are not blocked while
-- existing rows are scanned. The catalog view gains the five columns at its end and shows
-- flat fees only, which is every row it shows today, so its rows are unchanged. A new view,
-- published_fee_rate_catalog, shows percentage fees. The 3-fee rule in both views counts
-- every live fee, rates included, so a rate counts toward a bank's 3 fees.

ALTER TABLE public.raw_fee_observations
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

ALTER TABLE public.verified_fee_observations
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

ALTER TABLE public.published_fee_records
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rate_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS rate_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS rate_basis text;

DO $$
DECLARE
  tier text;
BEGIN
  FOREACH tier IN ARRAY ARRAY['raw_fee_observations', 'verified_fee_observations', 'published_fee_records'] LOOP
    EXECUTE format(
      $sql$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        (amount_kind = 'flat' AND rate_percent IS NULL AND rate_min_amount IS NULL AND rate_max_amount IS NULL AND rate_basis IS NULL)
        OR (amount_kind = 'percent' AND amount IS NULL AND rate_percent > 0 AND rate_percent <= 100
            AND (rate_min_amount IS NULL OR rate_min_amount >= 0)
            AND (rate_max_amount IS NULL OR rate_max_amount >= COALESCE(rate_min_amount, 0))
            AND (rate_basis IS NULL OR rate_basis IN ('transaction', 'settlement', 'advance', 'balance_transferred', 'balance', 'loan_balance')))
      ) NOT VALID$sql$,
      tier,
      tier || '_amount_kind_check'
    );
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', tier, tier || '_amount_kind_check');
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.published_fee_catalog
WITH (security_invoker = true)
AS
SELECT
  fp.fee_published_id AS id,
  fp.fee_published_id,
  fp.lineage_ref AS fee_verified_id,
  fv.fee_raw_id,
  fp.institution_id,
  fp.fee_name,
  fp.amount,
  fp.frequency,
  fr.conditions,
  COALESCE(fp.extraction_confidence, fv.extraction_confidence, fr.extraction_confidence) AS extraction_confidence,
  'approved'::text AS review_status,
  COALESCE(fv.outlier_flags, '[]'::jsonb) AS validation_flags,
  fp.canonical_fee_key AS fee_category,
  fp.canonical_fee_key,
  NULL::text AS fee_family,
  NULL::text AS account_product_type,
  false AS is_fee_cap,
  fp.variant_type,
  fp.coverage_tier,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS source_url,
  fr.source,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS document_url,
  COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key) AS document_r2_key,
  fr.source_document_id,
  COALESCE(fp.agent_event_id, fr.agent_event_id) AS agent_event_id,
  COALESCE(fp.verified_by_agent_event_id, fv.verified_by_agent_event_id) AS verified_by_agent_event_id,
  fp.published_by_adversarial_event_id,
  fp.batch_id,
  fp.published_at AS created_at,
  fp.published_at AS updated_at,
  fp.amount_kind,
  fp.rate_percent,
  fp.rate_min_amount,
  fp.rate_max_amount,
  fp.rate_basis
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.amount_kind = 'flat'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  );

REVOKE ALL ON public.published_fee_catalog FROM PUBLIC, anon, authenticated;

-- Percentage fees, with the same columns and the same 3-fee rule, for readers that show or
-- summarize rates. They stay out of published_fee_catalog, whose readers treat amount as
-- dollars; a NULL amount read as $0 would pull every median down.
CREATE OR REPLACE VIEW public.published_fee_rate_catalog
WITH (security_invoker = true)
AS
SELECT
  fp.fee_published_id AS id,
  fp.fee_published_id,
  fp.lineage_ref AS fee_verified_id,
  fv.fee_raw_id,
  fp.institution_id,
  fp.fee_name,
  fp.amount,
  fp.frequency,
  fr.conditions,
  COALESCE(fp.extraction_confidence, fv.extraction_confidence, fr.extraction_confidence) AS extraction_confidence,
  'approved'::text AS review_status,
  COALESCE(fv.outlier_flags, '[]'::jsonb) AS validation_flags,
  fp.canonical_fee_key AS fee_category,
  fp.canonical_fee_key,
  NULL::text AS fee_family,
  NULL::text AS account_product_type,
  false AS is_fee_cap,
  fp.variant_type,
  fp.coverage_tier,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS source_url,
  fr.source,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS document_url,
  COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key) AS document_r2_key,
  fr.source_document_id,
  COALESCE(fp.agent_event_id, fr.agent_event_id) AS agent_event_id,
  COALESCE(fp.verified_by_agent_event_id, fv.verified_by_agent_event_id) AS verified_by_agent_event_id,
  fp.published_by_adversarial_event_id,
  fp.batch_id,
  fp.published_at AS created_at,
  fp.published_at AS updated_at,
  fp.amount_kind,
  fp.rate_percent,
  fp.rate_min_amount,
  fp.rate_max_amount,
  fp.rate_basis
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.amount_kind = 'percent'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  );

REVOKE ALL ON public.published_fee_rate_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.published_fee_rate_catalog TO service_role;
