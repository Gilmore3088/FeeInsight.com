/**
 * `HTML_CELL_LIST_PAIRING_LIVE` (#1092) dry-run read: of the current documents an HTML reader wrote
 * the stored text of, the ones with a stored table row in the shape the switch reads, and the live
 * fees on them. Database-only, like the rest of the audit: the HTML bytes are in the document vault,
 * and `agent_source_texts.table_rows` keeps each row's cell text, not its list or `<br>` markup, so
 * the audit cannot say which of these rows would split. A row whose prices are all free words
 * ("FREE", "No fee") prints no dollar amount and is not counted here.
 */

/**
 * Current copies (fetched, not a duplicate, not superseded) whose newest completed text an HTML
 * reader wrote and whose stored table rows include a body row of an HTML table with exactly two
 * cells, the first with no dollar amount and the second with two or more: the one-line form of a
 * label list beside a price list. `$1` scope (null for every institution), `$2` the HTML reader names.
 */
export const HTML_CELL_LIST_EXPOSURE_SQL = `
  WITH current_docs AS (
    SELECT sd.id, sd.institution_id
      FROM source_documents sd
     WHERE sd.status = 'success' AND sd.duplicate_of_id IS NULL AND sd.superseded_by_id IS NULL
       AND ($1::bigint[] IS NULL OR sd.institution_id = ANY($1::bigint[]))
  ), newest AS (
    SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.reader, t.table_rows
      FROM agent_source_texts t
      JOIN current_docs c ON c.id = t.source_document_id
     WHERE t.status = 'completed' AND t.normalized_text IS NOT NULL
     ORDER BY t.source_document_id, t.id DESC
  ), html_rows AS (
    SELECT n.source_document_id, c.institution_id, r.value AS row
      FROM newest n
      JOIN current_docs c ON c.id = n.source_document_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(n.table_rows->'rows') = 'array' THEN n.table_rows->'rows' ELSE '[]'::jsonb END
      ) AS r(value)
     WHERE n.reader = ANY($2::text[])
  ), candidates AS (
    SELECT h.source_document_id, h.institution_id, count(*) AS rows
      FROM html_rows h
     WHERE h.row->>'origin' = 'html_table'
       AND COALESCE(h.row->>'header', 'false') <> 'true'
       AND jsonb_typeof(h.row->'cells') = 'array'
       AND jsonb_array_length(h.row->'cells') = 2
       AND (h.row->'cells'->>0) !~ '[$][[:space:]]?[0-9]'
       AND (SELECT count(*) FROM regexp_matches(h.row->'cells'->>1, '[$][[:space:]]?[0-9]', 'g')) >= 2
     GROUP BY h.source_document_id, h.institution_id
  ), live AS (
    SELECT fr.source_document_id, count(*) AS fees
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
       AND fr.source_document_id IN (SELECT source_document_id FROM candidates)
     GROUP BY fr.source_document_id
  )
  SELECT count(*)::int AS documents, count(DISTINCT k.institution_id)::int AS institutions,
         COALESCE(sum(k.rows), 0)::int AS rows,
         count(l.source_document_id)::int AS documents_with_live_fees, COALESCE(sum(l.fees), 0)::int AS live_fees
    FROM candidates k
    LEFT JOIN live l ON l.source_document_id = k.source_document_id`;
