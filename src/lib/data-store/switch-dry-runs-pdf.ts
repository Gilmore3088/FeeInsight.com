/**
 * `PDF_TEXT_DIRECTION_LIVE` (#1092) dry-run read: how many current documents, and how many live
 * fees on them, the PDF reader wrote the stored text of, and of those how many a read since Nov 3
 * found sideways pages in. Database-only, like the rest of the audit: the PDF bytes are in the
 * document vault, so the audit cannot re-read a file. The flip bumps PDF_READ_VERSION, so every
 * counted document is re-read once; only a sideways one can change, and Rosetta's lost-text rule
 * keeps a stored text unless the new one lists at least as many fees.
 */

/** The reader that writes PDF text through `extractPdfDocumentText`. Equal to PDF_READ_READERS. */
export const PDF_READERS = ["read.pdf_layout"];

/**
 * Current copies (fetched, not a duplicate, not superseded) whose newest completed text the PDF
 * reader wrote, with the live fees each carries. `direction_known` counts those with a read of the
 * text's bytes that records `pdf_read` (every PDF read since this audit's section shipped, which
 * also records `pdf_text_direction` when it finds a sideways page); `sideways` those whose read
 * found one. `$1` scope (null for every institution), `$2` the PDF reader names.
 */
export const PDF_READER_EXPOSURE_SQL = `
  WITH current_docs AS (
    SELECT sd.id, sd.institution_id
      FROM source_documents sd
     WHERE sd.status = 'success' AND sd.duplicate_of_id IS NULL AND sd.superseded_by_id IS NULL
       AND ($1::bigint[] IS NULL OR sd.institution_id = ANY($1::bigint[]))
  ), newest AS (
    SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.reader, t.source_hash
      FROM agent_source_texts t
      JOIN current_docs c ON c.id = t.source_document_id
     WHERE t.status = 'completed' AND t.normalized_text IS NOT NULL
     ORDER BY t.source_document_id, t.id DESC
  ), pdf_docs AS (
    SELECT n.source_document_id, c.institution_id,
           EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.stage = 'read' AND pa.institution_id = c.institution_id
                AND pa.input_fingerprint = n.source_hash AND pa.detail ? 'pdf_read'
           ) AS direction_known,
           EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.stage = 'read' AND pa.institution_id = c.institution_id
                AND pa.input_fingerprint = n.source_hash
                AND jsonb_typeof(pa.detail->'pdf_text_direction'->'pages') = 'array'
                AND jsonb_array_length(pa.detail->'pdf_text_direction'->'pages') > 0
           ) AS sideways
      FROM newest n
      JOIN current_docs c ON c.id = n.source_document_id
     WHERE n.reader = ANY($2::text[])
  ), live AS (
    SELECT fr.source_document_id, count(*) AS fees
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
       AND fr.source_document_id IN (SELECT source_document_id FROM pdf_docs)
     GROUP BY fr.source_document_id
  )
  SELECT count(*)::int AS documents, count(DISTINCT p.institution_id)::int AS institutions,
         count(l.source_document_id)::int AS documents_with_live_fees, COALESCE(sum(l.fees), 0)::int AS live_fees,
         count(*) FILTER (WHERE p.direction_known)::int AS direction_known,
         count(*) FILTER (WHERE p.sideways)::int AS sideways,
         COALESCE(sum(l.fees) FILTER (WHERE p.sideways), 0)::int AS sideways_live_fees
    FROM pdf_docs p
    LEFT JOIN live l ON l.source_document_id = p.source_document_id`;
