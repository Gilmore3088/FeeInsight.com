-- Fee audience/source review data repair — 2026-10-10
--
-- NOT A SCHEMA MIGRATION. Run only after migrations
--   20270110000040 fee_audience_integrity
--   20270110000041 pinnacle_audience_correction
-- are installed in the target database and after re-reading the exact lineage below.
--
-- Purpose:
--   * evidence-backed business scope for 21 already-correct fee rows;
--   * preserve 3 audience-screen false positives as unknown (no guessed audience);
--   * quarantine 3 confirmed category/unit errors and 5 uncertain/inaccessible rows;
--   * record every disposition in pipeline_feedback;
--   * never delete history, invent a price, or write fee_change_records / fee-movement signals.
--
-- The replacement path for quarantined records is the normal source-bound pipeline.
-- This file is an operator receipt/script so its data decisions can be reviewed separately
-- from schema migrations and re-run safely. It is deliberately exact-ID guarded.

BEGIN;

CREATE TEMP TABLE fee_audience_review_20261010 (
  fee_published_id bigint PRIMARY KEY,
  institution_id integer NOT NULL,
  fee_raw_id bigint NOT NULL,
  fee_verified_id bigint NOT NULL,
  source_document_id bigint NOT NULL,
  expected_category text NOT NULL,
  expected_amount numeric NOT NULL,
  disposition text NOT NULL CHECK (disposition IN (
    'business_scope',
    'confirmed_error',
    'uncertain_quarantine',
    'false_positive_no_change'
  )),
  evidence text NOT NULL
) ON COMMIT DROP;

INSERT INTO fee_audience_review_20261010
  (fee_published_id,institution_id,fee_raw_id,fee_verified_id,source_document_id,
   expected_category,expected_amount,disposition,evidence)
VALUES
  (10668,36,338,3438,18,'money_order',10,'confirmed_error',
   'Webster source row is Currency Order Fee, business clients only, $10; published category money_order is wrong.'),
  (82133,47,321498,91666,21192,'courier_delivery',15,'business_scope',
   'Courier Pick-Up (business clients only), $15 per item.'),
  (22081,81,107572,21905,14405,'paper_statement',3,'business_scope',
   'Paper Statement Fee $3 per month per account, applies to business accounts only.'),
  (63316,108,254150,67055,18922,'deposited_item_return',10,'business_scope',
   'Returned Deposit Items, business only, $10.'),
  (80656,108,318410,90633,18922,'nsf',36,'business_scope',
   'Non-Sufficient Funds, business accounts only, $36.'),
  (84799,127,303956,94044,20609,'deposited_item_return',12,'business_scope',
   'Chargeback Fee, charged on business accounts only, $12; text-only source review.'),
  (55008,132,190119,57725,50,'continuous_od',7,'uncertain_quarantine',
   'Stored excerpt says Sustained Overdraft business only $7/day, but current source was inaccessible; quarantine pending matching source verification.'),
  (103764,270,460194,118671,23804,'continuous_od',6,'business_scope',
   'Continuous Overdraft Fee, business accounts only, $6/day after 9 consecutive calendar days overdrawn.'),
  (97726,291,409691,110863,22679,'deposited_item_return',4,'business_scope',
   'Deposit Item Returned Fee, business accounts only, $4.'),
  (16701,338,117638,10218,14541,'wire_domestic_incoming',10,'confirmed_error',
   'Woori $10MM figure is a transaction threshold in a short-term-deposit footnote, not a $10 incoming wire fee.'),
  (86171,425,337779,95698,21553,'deposited_item_return',7,'business_scope',
   'Returned Deposited Items $7 each, business only; text-only source review.'),
  (96049,480,308433,104332,20738,'check_cashing',1,'business_scope',
   'Cashed Check/Withdrawal $1, specifically MSB check-cashing business only, per item.'),
  (25896,510,139786,13573,9256,'deposited_item_return',15,'business_scope',
   'Returned Deposited Item Fee, business accounts only, $15 per item.'),
  (33470,555,145911,27127,275,'deposited_item_return',10,'uncertain_quarantine',
   'Stored row says business returned deposit item $10 but includes neighboring Safe Deposit Box label; source inaccessible.'),
  (76513,570,274493,82504,18511,'nsf',9,'uncertain_quarantine',
   'Returned Item Fee, business accounts only, $9/item; source does not establish NSF versus returned deposited item category.'),
  (97827,756,410945,110978,14272,'deposited_item_return',10,'business_scope',
   'Returned Deposited Item, business accounts only, $10; source column supplies per-item unit.'),
  (93888,776,384760,106048,22124,'paper_statement',2,'business_scope',
   'Paper Statement Mailing Fee, business accounts only, $2; source does not establish monthly frequency.'),
  (75569,844,209374,87476,17401,'deposited_item_return',5,'uncertain_quarantine',
   'Stored excerpt says Charge Back Fee business only $5; current source inaccessible.'),
  (66354,1123,268150,73931,23770,'deposited_item_return',5,'business_scope',
   'Chargebacks, business accounts only, $5 per item.'),
  (61200,1484,118102,64245,15002,'overdraft',25,'false_positive_no_change',
   'NSF Paid Item(s) Charge $25/item is supported; neighboring monthly-statement row contains the business-only phrase. Audience remains unknown.'),
  (98549,1484,418441,112018,15002,'document_reproduction',1,'confirmed_error',
   'Interim Statement, business accounts only, $1 per PAGE; stored frequency per_item is wrong and must be re-extracted.'),
  (31695,1616,145846,27251,742,'deposited_item_return',4,'business_scope',
   'Deposit item return charge $4 per item, business accounts only; text-only source review.'),
  (18821,1671,134888,12644,14362,'ach_origination',25,'business_scope',
   'ACH Origination Services, business customers only, assessed monthly $25; text-only source review.'),
  (15540,1842,108369,8861,14670,'nsf',30,'uncertain_quarantine',
   'Stored business-NSF excerpt contains $30 and neighboring $35; source inaccessible, so row/price binding remains unresolved.'),
  (100291,2710,434728,114113,23033,'deposited_item_return',5,'business_scope',
   'Return Deposit Item Fee, business accounts only, $5 per item.'),
  (39478,2741,145971,33060,13893,'deposited_item_return',10,'business_scope',
   'Returned Deposited Item, business accounts only, $10; text-only source review.'),
  (70553,3212,265913,72667,15945,'deposited_item_return',20,'business_scope',
   'Deposit Item Return Fee, business accounts only, $20; preserve category distinct from neighboring return charge.'),
  (103573,4885,458352,118370,23737,'deposited_item_return',10,'business_scope',
   'Return of Deposited Item / Return Check Charge, business accounts only, $10.'),
  (83732,6107,277822,78647,19837,'deposited_item_return',10,'business_scope',
   'Return Deposit Item, NOT OWN CHECK, business accounts only, $10.'),
  (90460,6364,370235,101153,21894,'notary_fee',0,'false_positive_no_change',
   'Notary Service FREE; "Credit Union Business Only" restricts service purpose, not demonstrated account audience. Leave audience unknown.'),
  (90461,6364,370236,101154,21894,'document_reproduction',0,'false_positive_no_change',
   'Photocopies FREE; "Credit Union Business Only" restricts service purpose, not demonstrated account audience. Leave audience unknown.'),
  (61707,7285,229298,64793,18265,'deposited_item_return',12,'business_scope',
   'Deposited Check Returned Unpaid $12 per item, business accounts only; text-only source review.');

DO $$
DECLARE
  n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='raw_fee_observations' AND column_name='fee_audience'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='published_fee_records' AND column_name='quarantined_at'
  ) THEN
    RAISE EXCEPTION 'fee audience/quarantine schema not installed; apply migrations 40/41 first';
  END IF;

  SELECT count(*) INTO n FROM fee_audience_review_20261010;
  IF n <> 32 THEN RAISE EXCEPTION 'repair manifest must contain exactly 32 rows, found %', n; END IF;

  SELECT count(*) INTO n
    FROM fee_audience_review_20261010 m
    JOIN public.published_fee_records p
      ON p.fee_published_id=m.fee_published_id
     AND p.institution_id=m.institution_id
     AND p.lineage_ref=m.fee_verified_id
     AND p.canonical_fee_key=m.expected_category
     AND p.amount IS NOT DISTINCT FROM m.expected_amount
    JOIN public.verified_fee_observations v
      ON v.fee_verified_id=m.fee_verified_id
     AND v.fee_raw_id=m.fee_raw_id
     AND v.institution_id=m.institution_id
    JOIN public.raw_fee_observations r
      ON r.fee_raw_id=m.fee_raw_id
     AND r.institution_id=m.institution_id
     AND r.source_document_id=m.source_document_id;
  IF n <> 32 THEN
    RAISE EXCEPTION 'one or more exact lineage/category/amount/source preconditions changed; expected 32 matches, found %', n;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM fee_audience_review_20261010 m
      JOIN public.raw_fee_observations r ON r.fee_raw_id=m.fee_raw_id
     WHERE m.disposition='business_scope'
       AND r.fee_audience NOT IN ('unknown','business')
  ) THEN
    RAISE EXCEPTION 'a scope-only row already has incompatible audience; inspect before repair';
  END IF;
END $$;

-- 21 evidence-backed scope-only rows: preserve their fee/category/amount/frequency/history,
-- and attach business applicability to the existing lineage.
UPDATE public.raw_fee_observations r
   SET fee_audience='business',
       audience_evidence=m.evidence,
       fee_treatment='charged'
  FROM fee_audience_review_20261010 m
 WHERE m.disposition='business_scope'
   AND r.fee_raw_id=m.fee_raw_id
   AND r.institution_id=m.institution_id
   AND r.source_document_id=m.source_document_id
   AND (r.fee_audience,r.audience_evidence,r.fee_treatment)
       IS DISTINCT FROM ('business'::text,m.evidence,'charged'::text);

-- The migration-40 lineage triggers re-read the parent values; touching these columns is
-- intentional and does not fabricate a new verification or publication event.
UPDATE public.verified_fee_observations v
   SET fee_audience='business',
       audience_evidence=m.evidence,
       fee_treatment='charged'
  FROM fee_audience_review_20261010 m
 WHERE m.disposition='business_scope'
   AND v.fee_verified_id=m.fee_verified_id
   AND v.fee_raw_id=m.fee_raw_id;

UPDATE public.published_fee_records p
   SET fee_audience='business',
       audience_evidence=m.evidence,
       fee_treatment='charged'
  FROM fee_audience_review_20261010 m
 WHERE m.disposition='business_scope'
   AND p.fee_published_id=m.fee_published_id
   AND p.lineage_ref=m.fee_verified_id;

INSERT INTO public.pipeline_feedback (
  about_stage,signal,kind,reported_by,check_name,institution_id,source_document_id,
  source_url,fee_raw_id,fee_verified_id,fee_published_id,canonical_fee_key,amount,
  evidence,dedupe_key
)
SELECT 'extract','wrong','audience_scope_backfill','human','human.fee_audience_review_20261010',
       m.institution_id,m.source_document_id,r.source_url,m.fee_raw_id,m.fee_verified_id,
       m.fee_published_id,m.expected_category,m.expected_amount,
       jsonb_build_object(
         'disposition','business_scope',
         'reason',m.evidence,
         'before_audience','unknown',
         'after_audience','business',
         'reviewed_on','2026-10-10'
       ),
       'fee-audience-review-20261010:pub:'||m.fee_published_id
  FROM fee_audience_review_20261010 m
  JOIN public.raw_fee_observations r ON r.fee_raw_id=m.fee_raw_id
 WHERE m.disposition='business_scope'
ON CONFLICT (dedupe_key) DO UPDATE
  SET signal=EXCLUDED.signal, kind=EXCLUDED.kind, reported_by=EXCLUDED.reported_by,
      check_name=EXCLUDED.check_name, evidence=EXCLUDED.evidence, updated_at=NOW();

-- Three screening false positives: explicitly record the review, but DO NOT infer consumer
-- or business audience. Unknown remains unknown and therefore stays out of consumer stats.
INSERT INTO public.pipeline_feedback (
  about_stage,signal,kind,reported_by,check_name,institution_id,source_document_id,
  source_url,fee_raw_id,fee_verified_id,fee_published_id,canonical_fee_key,amount,
  evidence,dedupe_key
)
SELECT 'extract','right','audience_screen_false_positive','human','human.fee_audience_review_20261010',
       m.institution_id,m.source_document_id,r.source_url,m.fee_raw_id,m.fee_verified_id,
       m.fee_published_id,m.expected_category,m.expected_amount,
       jsonb_build_object(
         'disposition','false_positive_no_change',
         'reason',m.evidence,
         'audience','unknown',
         'reviewed_on','2026-10-10'
       ),
       'fee-audience-review-20261010:pub:'||m.fee_published_id
  FROM fee_audience_review_20261010 m
  JOIN public.raw_fee_observations r ON r.fee_raw_id=m.fee_raw_id
 WHERE m.disposition='false_positive_no_change'
ON CONFLICT (dedupe_key) DO UPDATE
  SET signal=EXCLUDED.signal, kind=EXCLUDED.kind, reported_by=EXCLUDED.reported_by,
      check_name=EXCLUDED.check_name, evidence=EXCLUDED.evidence, updated_at=NOW();

-- Eight rows are not safe to keep live as currently represented: three confirmed
-- category/unit/binding errors and five uncertain/inaccessible records. Preserve everything,
-- block the exact raw lineage from republishing, reject its verified row, and quarantine the
-- publication immediately. A replacement must come through the normal pipeline.
WITH bad AS (
  SELECT * FROM fee_audience_review_20261010
   WHERE disposition IN ('confirmed_error','uncertain_quarantine')
)
UPDATE public.raw_fee_observations r
   SET outlier_flags =
         (r.outlier_flags - 'needs_darwin_verification')
         || '["audience_correction_required","manual_data_correction_required"]'::jsonb
  FROM bad m
 WHERE r.fee_raw_id=m.fee_raw_id
   AND NOT r.outlier_flags ? 'manual_data_correction_required';

WITH bad AS (
  SELECT * FROM fee_audience_review_20261010
   WHERE disposition IN ('confirmed_error','uncertain_quarantine')
)
UPDATE public.verified_fee_observations v
   SET review_status='rejected',
       outlier_flags=v.outlier_flags
         || '["audience_correction_required","manual_data_correction_required"]'::jsonb
  FROM bad m
 WHERE v.fee_verified_id=m.fee_verified_id
   AND NOT v.outlier_flags ? 'manual_data_correction_required';

WITH bad AS (
  SELECT * FROM fee_audience_review_20261010
   WHERE disposition IN ('confirmed_error','uncertain_quarantine')
)
UPDATE public.published_fee_records p
   SET quarantined_at=COALESCE(p.quarantined_at,NOW()),
       quarantine_reason=COALESCE(
         p.quarantine_reason,
         'fee_audience_review_20261010: '||m.disposition
       ),
       rolled_back_at=COALESCE(p.rolled_back_at,NOW()),
       rolled_back_by_batch_id=COALESCE(p.rolled_back_by_batch_id,'fee-audience-review-20261010'),
       rolled_back_reason=COALESCE(
         p.rolled_back_reason,
         'fee_audience_review_20261010:'||m.disposition
       )
  FROM bad m
 WHERE p.fee_published_id=m.fee_published_id;

INSERT INTO public.pipeline_feedback (
  about_stage,signal,kind,reported_by,check_name,institution_id,source_document_id,
  source_url,fee_raw_id,fee_verified_id,fee_published_id,canonical_fee_key,amount,
  evidence,dedupe_key
)
SELECT 'extract','wrong',
       CASE WHEN m.disposition='confirmed_error'
            THEN 'confirmed_data_error'
            ELSE 'insufficient_evidence_quarantine' END,
       'human','human.fee_audience_review_20261010',
       m.institution_id,m.source_document_id,r.source_url,m.fee_raw_id,m.fee_verified_id,
       m.fee_published_id,m.expected_category,m.expected_amount,
       jsonb_build_object(
         'disposition',m.disposition,
         'reason',m.evidence,
         'replacement_policy','normal_pipeline_only',
         'reviewed_on','2026-10-10'
       ),
       'fee-audience-review-20261010:pub:'||m.fee_published_id
  FROM fee_audience_review_20261010 m
  JOIN public.raw_fee_observations r ON r.fee_raw_id=m.fee_raw_id
 WHERE m.disposition IN ('confirmed_error','uncertain_quarantine')
ON CONFLICT (dedupe_key) DO UPDATE
  SET signal=EXCLUDED.signal, kind=EXCLUDED.kind, reported_by=EXCLUDED.reported_by,
      check_name=EXCLUDED.check_name, evidence=EXCLUDED.evidence, updated_at=NOW();

DO $$
DECLARE
  scoped int;
  unchanged int;
  quarantined int;
  feedback_rows int;
BEGIN
  SELECT count(*) INTO scoped
    FROM fee_audience_review_20261010 m
    JOIN public.published_fee_records p ON p.fee_published_id=m.fee_published_id
   WHERE m.disposition='business_scope'
     AND p.fee_audience='business'
     AND p.quarantined_at IS NULL;

  SELECT count(*) INTO unchanged
    FROM fee_audience_review_20261010 m
    JOIN public.published_fee_records p ON p.fee_published_id=m.fee_published_id
   WHERE m.disposition='false_positive_no_change'
     AND p.fee_audience='unknown'
     AND p.quarantined_at IS NULL;

  SELECT count(*) INTO quarantined
    FROM fee_audience_review_20261010 m
    JOIN public.published_fee_records p ON p.fee_published_id=m.fee_published_id
   WHERE m.disposition IN ('confirmed_error','uncertain_quarantine')
     AND p.quarantined_at IS NOT NULL;

  SELECT count(*) INTO feedback_rows
    FROM public.pipeline_feedback
   WHERE dedupe_key LIKE 'fee-audience-review-20261010:pub:%';

  IF scoped <> 21 OR unchanged <> 3 OR quarantined <> 8 OR feedback_rows <> 32 THEN
    RAISE EXCEPTION
      'repair postcondition failed: scoped %, unchanged %, quarantined %, feedback %',
      scoped,unchanged,quarantined,feedback_rows;
  END IF;
END $$;

COMMIT;

-- Operator receipt:
SELECT
  count(*) FILTER (WHERE p.fee_audience='business' AND p.quarantined_at IS NULL) AS scoped_business_live,
  count(*) FILTER (WHERE p.fee_audience='unknown' AND p.quarantined_at IS NULL) AS reviewed_unknown_live,
  count(*) FILTER (WHERE p.quarantined_at IS NOT NULL) AS quarantined
FROM fee_audience_review_20261010 m
JOIN public.published_fee_records p ON p.fee_published_id=m.fee_published_id;
