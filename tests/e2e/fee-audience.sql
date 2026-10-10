-- Run ONLY on the throwaway CI database, after production-schema.sql. Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_ok(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

-- Minimal copies of the diagnosed lineage, plus three unaffected categories so coverage
-- cannot accidentally make a bad publication disappear from the assertions below.
INSERT INTO public.raw_fee_observations
  (fee_raw_id,institution_id,source_document_id,source_url,agent_event_id,fee_name,amount,conditions)
VALUES
 (321488,47,21164,'https://www.pnfp.com/Overdraft',gen_random_uuid(),
  'We''ve eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from',30,
  'excerpt="- We''ve eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from $38 to $30 for business clients."'),
 (321489,47,21164,'https://www.pnfp.com/Overdraft',gen_random_uuid(),
  'We''ve lowered Overdraft Paid Item fees from',30,
  'excerpt="- We''ve lowered Overdraft Paid Item fees from $38 to $30 for all clients."'),
 (950001,47,21164,'https://www.pnfp.com/Overdraft',gen_random_uuid(),'Test stop payment',20,'Test fixture'),
 (950002,47,21164,'https://www.pnfp.com/Overdraft',gen_random_uuid(),'Test wire',25,'Test fixture'),
 (950003,47,21164,'https://www.pnfp.com/Overdraft',gen_random_uuid(),'Test statement',3,'Test fixture');
INSERT INTO public.verified_fee_observations
 (fee_verified_id,fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount)
SELECT CASE fee_raw_id WHEN 321488 THEN 110743 WHEN 321489 THEN 110744 ELSE fee_raw_id END,
       fee_raw_id,institution_id,
       CASE fee_raw_id WHEN 321488 THEN 'nsf' WHEN 321489 THEN 'overdraft'
         WHEN 950001 THEN 'stop_payment' WHEN 950002 THEN 'wire_domestic_outgoing' ELSE 'paper_statement' END,
       gen_random_uuid(),fee_name,amount
 FROM public.raw_fee_observations WHERE fee_raw_id IN (321488,321489,950001,950002,950003);
INSERT INTO public.published_fee_records
 (fee_published_id,lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount)
SELECT CASE fee_verified_id WHEN 110743 THEN 97662 WHEN 110744 THEN 97663 ELSE fee_verified_id END,
       fee_verified_id,institution_id,canonical_fee_key,gen_random_uuid(),fee_name,amount
 FROM public.verified_fee_observations WHERE fee_verified_id IN (110743,110744,950001,950002,950003);
SELECT pg_temp.assert_ok((SELECT count(*)=5 FROM public.published_fee_catalog WHERE institution_id=47),'Baseline must expose all five fixture records');

\ir ../../supabase/migrations/20270110000041_pinnacle_audience_correction.sql
\ir ../../supabase/migrations/20270110000041_pinnacle_audience_correction.sql
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.published_fee_catalog WHERE institution_id=47),'Confirmed errors must be hidden BEFORE a replacement exists');
SELECT pg_temp.assert_ok((SELECT count(*)=2 FROM public.pipeline_feedback WHERE dedupe_key LIKE 'pinnacle-audience-correction:pub:%'),'Correction must be idempotent');
SELECT pg_temp.assert_ok((SELECT amount=30 AND quarantined_at IS NOT NULL FROM public.published_fee_records WHERE fee_published_id=97662),'Preserve the old amount and history');

-- A legacy restore clearing rollback fields cannot bypass an explicit quarantine.
UPDATE public.published_fee_records SET rolled_back_at=NULL,rolled_back_reason=NULL,rolled_back_by_batch_id=NULL WHERE fee_published_id=97662;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT 1 FROM public.published_fee_catalog WHERE fee_published_id=97662),'Quarantine must survive legacy restore');
DO $$ DECLARE refused boolean := false; BEGIN
  BEGIN
    INSERT INTO public.published_fee_records(lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount)
    VALUES(110743,47,'nsf',gen_random_uuid(),'Old unscoped NSF',30);
  EXCEPTION WHEN raise_exception THEN refused := true; END;
  PERFORM pg_temp.assert_ok(refused,'Blocked source observation must not be republished');
END $$;

-- New scoped observations carry real source evidence through each stage. These are test
-- fixtures, not a production shortcut around Knox/Darwin/Hamilton.
INSERT INTO public.raw_fee_observations
 (fee_raw_id,institution_id,source_document_id,agent_event_id,fee_name,amount,fee_audience,audience_evidence,fee_treatment,outlier_flags)
VALUES
 (950010,47,21164,gen_random_uuid(),'NSF returned item (consumer)',0,'consumer','Eliminated consumer NSF; business NSF reduced from $38 to $30','eliminated','["knox_review:zero"]'),
 (950011,47,21164,gen_random_uuid(),'NSF returned item (business)',30,'business','Eliminated consumer NSF; business NSF reduced from $38 to $30','charged','[]');
INSERT INTO public.verified_fee_observations
 (fee_verified_id,fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount)
SELECT fee_raw_id,fee_raw_id,institution_id,'nsf',gen_random_uuid(),fee_name,amount
 FROM public.raw_fee_observations WHERE fee_raw_id IN (950010,950011);
INSERT INTO public.published_fee_records
 (fee_published_id,lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount)
SELECT fee_verified_id,fee_verified_id,institution_id,canonical_fee_key,gen_random_uuid(),fee_name,amount
 FROM public.verified_fee_observations WHERE fee_verified_id IN (950010,950011);
SELECT pg_temp.assert_ok((SELECT amount=0 AND fee_audience='consumer' AND fee_treatment='eliminated' FROM public.published_fee_catalog WHERE fee_published_id=950010),'Consumer $0 must remain a sourced, eliminated fee');
SELECT pg_temp.assert_ok((SELECT amount=30 AND fee_audience='business' FROM public.published_fee_catalog WHERE fee_published_id=950011),'Business $30 must remain separate');
SELECT pg_temp.assert_ok((SELECT count(*)=1 AND min(amount)=0 FROM public.published_fee_catalog WHERE institution_id=47 AND fee_category='nsf' AND fee_audience IN ('consumer','both')),'Consumer stats must not pool business $30 with zero');

-- Same-name/same-price observations for different audiences are distinct database keys.
INSERT INTO public.raw_fee_observations(institution_id,source_document_id,agent_event_id,fee_name,amount,fee_audience,audience_evidence,fee_treatment)
VALUES (900047,900047,gen_random_uuid(),'Test equal-price fee',9,'consumer','Consumer accounts: $9','charged'),
       (900047,900047,gen_random_uuid(),'Test equal-price fee',9,'business','Business accounts: $9','charged');
SELECT pg_temp.assert_ok((SELECT count(*)=2 FROM public.raw_fee_observations WHERE institution_id=900047),'Audience belongs in raw deduplication');

-- Historical second-look confirmation is not an active quarantine.
INSERT INTO public.pipeline_feedback(about_stage,signal,kind,reported_by,fee_published_id,dedupe_key)
VALUES('publish','wrong','takedown_confirmed','hamilton',950010,'test-historical-confirmation');
SELECT pg_temp.assert_ok(EXISTS(SELECT 1 FROM public.published_fee_catalog WHERE fee_published_id=950010),'Old confirmation history must not hide a restored valid fee');
SELECT pg_temp.assert_ok(NOT has_table_privilege('anon','public.published_fee_catalog','SELECT'),'Migration must not grant anonymous catalog access');
SELECT pg_temp.assert_ok(NOT has_function_privilege('anon','public.inherit_fee_applicability()','EXECUTE'),'Internal trigger must not become a public RPC');
SELECT pg_temp.assert_ok((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.published_fee_catalog'::regclass),'Catalog must use invoker security');
ROLLBACK;
\echo 'Fee audience migration assertions passed'
