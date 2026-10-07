-- Checking account lineup fields on Knox's raw fee rows (account lineup audit, 7 Oct 2026).
--
-- A monthly maintenance fee belongs to one checking product, and a buyer comparing a market
-- needs that product's name, the balance that avoids the fee, the deposit needed to open it
-- and the waiver wording. No column held any of these, and published_fee_catalog returned a
-- hard-coded NULL account_product_type. Knox now reads them for monthly_maintenance fees only,
-- each grounded in the source text (a value the text does not state is stored as NULL).
--
--   product_name          the account's name as written ("Premier Checking")
--   min_balance_to_avoid  dollar balance that avoids the monthly fee
--   min_opening_deposit   dollar deposit needed to open the account
--   waiver_text           the waiver wording, copied from the text
--
-- The columns live on raw_fee_observations only: the catalog already joins each published fee
-- to its raw row, so verified and published rows do not copy them.
--
-- Data change: none. Four nullable columns with no default (no table rewrite) and a view
-- redefinition. The catalog keeps every column in the same order with the same types;
-- account_product_type now reads product_name (still text), and the three other fields are
-- added at the end. Every existing row has NULL in all four, so the view's rows are unchanged.

ALTER TABLE public.raw_fee_observations
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS min_balance_to_avoid numeric,
  ADD COLUMN IF NOT EXISTS min_opening_deposit numeric,
  ADD COLUMN IF NOT EXISTS waiver_text text;

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
  fr.product_name AS account_product_type,
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
  fp.rate_basis,
  fr.min_balance_to_avoid,
  fr.min_opening_deposit,
  fr.waiver_text
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
