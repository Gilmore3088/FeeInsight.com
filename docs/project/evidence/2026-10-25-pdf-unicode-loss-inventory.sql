-- #2598 read-only exports. Run each transaction separately when the client returns only the last result.
-- The cheap replacement screen must materialize before regexes. Never a repair/runtime surface.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s';
WITH bad AS MATERIALIZED (
 SELECT id,source_document_id,institution_id,source_hash,text_hash,reader,status,source_url,normalized_text
 FROM agent_source_texts WHERE document_type='pdf' AND strpos(COALESCE(normalized_text,''),chr(65533))>0
)
SELECT CURRENT_TIMESTAMP AS measured_at,t.id AS source_text_id,t.source_document_id,t.institution_id,
t.source_hash,t.text_hash,t.reader,t.source_url,d.document_r2_key
FROM bad t JOIN source_documents d ON d.id=t.source_document_id
WHERE t.status='completed' AND d.status='success' AND t.source_hash=d.content_hash
AND d.superseded_by_id IS NULL AND d.duplicate_of_id IS NULL
AND t.normalized_text ~ ('([[:alnum:]]'||chr(65533)||'|'||chr(65533)||'[[:alnum:]])')
ORDER BY t.source_document_id; COMMIT;

-- Published-fee baseline for the exported Oct 25 candidate IDs; regenerate the candidate set for a later incident snapshot.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s';
SELECT CURRENT_TIMESTAMP AS measured_at,p.id AS published_id,p.fee_raw_id,p.fee_verified_id,p.institution_id,
p.source_document_id,p.fee_name,p.amount,p.canonical_fee_key,p.frequency,p.amount_kind,p.rate_percent,
p.rate_min_amount,p.rate_max_amount,p.rate_basis,p.variant_type,p.fee_audience,p.account_product_type,
p.conditions,p.waiver_text,p.min_balance_to_avoid,p.min_opening_deposit,p.fee_treatment,
p.source_url,p.document_url,p.agent_event_id,p.verified_by_agent_event_id,p.published_by_adversarial_event_id
FROM published_fee_catalog p
WHERE p.source_document_id = ANY(ARRAY[330,2240,6958,8005,12280,12627,12917,13908,15683,16670,17457,18129,21529,23372,24430,24608,25439,26441,26926,27851,28625,29956,31383,31770,32029,32055,32454,32754,33712,36184]::int[])
ORDER BY p.source_document_id,p.id; COMMIT;
