-- Prepared read-only diagnostics for #2598. Never a repair or a runtime surface.
-- Materialize the cheap U+FFFD screen before applying regexes or joining the catalog.
-- Whole-text regex scans and per-document repeated catalog subqueries timed out
-- during investigation; keep a bounded timeout and export candidates before fee joins.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH bad AS MATERIALIZED (
  SELECT id, source_document_id, institution_id, source_hash, text_hash, reader,
         document_type, status, source_url, normalized_text
    FROM agent_source_texts
   WHERE strpos(COALESCE(normalized_text, ''), chr(65533)) > 0
), candidates AS MATERIALIZED (
  SELECT t.id AS source_text_id, t.source_document_id, t.institution_id,
         t.source_hash, t.text_hash, t.reader, t.source_url, d.document_r2_key
    FROM bad t JOIN source_documents d ON d.id = t.source_document_id
   WHERE t.document_type = 'pdf' AND t.status = 'completed' AND d.status = 'success'
     AND t.source_hash = d.content_hash
     AND d.superseded_by_id IS NULL AND d.duplicate_of_id IS NULL
     AND t.normalized_text ~ ('([[:alnum:]]' || chr(65533) || '|' || chr(65533) || '[[:alnum:]])')
)
SELECT CURRENT_TIMESTAMP AS measured_at, * FROM candidates ORDER BY source_document_id;
COMMIT;

-- In a separate READ ONLY transaction, take the exported explicit document IDs
-- and fetch their live-fee baselines through published_fee_catalog once. Also
-- export all affected superseded/duplicate/paid-reader texts separately; current
-- replay eligibility is not a definition of the whole historical incident.
-- The SQL POSIX alnum screen is a census aid. The TypeScript Unicode property
-- check is the admission boundary; independently test the corpus before rollout.
