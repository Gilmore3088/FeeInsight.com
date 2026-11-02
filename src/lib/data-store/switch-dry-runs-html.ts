/**
 * `HTML_ROW_PAIRING_LIVE` (#1092) dry-run read: how many current documents, and how many live fees
 * on them, an HTML reader wrote the stored text of. Database-only, like the rest of the audit: the
 * HTML bytes are in the document vault, not the database, so the audit cannot re-read a page and
 * diff its stored text. The count is the exposure, an upper bound on the documents whose text the
 * switch could change; Rosetta's lost-text rule keeps a stored text unless the new one lists at
 * least as many fees.
 */

/** The readers that write HTML through `extractHtmlDomText`: the static reader and the JavaScript fallback. */
export const HTML_READERS = ["read.html_dom", "read.js_fallback"];

/**
 * Current copies (fetched, not a duplicate, not superseded) by the reader of their newest completed
 * text, kept to the HTML readers and the legacy reader (no `reader` recorded, format unknown), with the
 * live fees each carries. `$1` scope (null for every institution), `$2` the HTML reader names.
 */
export const HTML_READER_EXPOSURE_SQL = `
  WITH current_docs AS (
    SELECT sd.id, sd.institution_id
      FROM source_documents sd
     WHERE sd.status = 'success' AND sd.duplicate_of_id IS NULL AND sd.superseded_by_id IS NULL
       AND ($1::bigint[] IS NULL OR sd.institution_id = ANY($1::bigint[]))
  ), newest AS (
    SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.reader
      FROM agent_source_texts t
      JOIN current_docs c ON c.id = t.source_document_id
     WHERE t.status = 'completed' AND t.normalized_text IS NOT NULL
     ORDER BY t.source_document_id, t.id DESC
  ), html_docs AS (
    SELECT n.source_document_id, COALESCE(n.reader, 'legacy') AS reader, c.institution_id
      FROM newest n
      JOIN current_docs c ON c.id = n.source_document_id
     WHERE n.reader IS NULL OR n.reader = ANY($2::text[])
  ), live AS (
    SELECT fr.source_document_id, count(*) AS fees
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
       AND fr.source_document_id IN (SELECT source_document_id FROM html_docs)
     GROUP BY fr.source_document_id
  )
  SELECT h.reader, count(*)::int AS documents, count(DISTINCT h.institution_id)::int AS institutions,
         count(l.source_document_id)::int AS documents_with_live_fees, COALESCE(sum(l.fees), 0)::int AS live_fees
    FROM html_docs h
    LEFT JOIN live l ON l.source_document_id = h.source_document_id
   GROUP BY h.reader
   ORDER BY h.reader`;
