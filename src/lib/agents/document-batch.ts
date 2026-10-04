/**
 * Tail of a batch query that moves fees a whole source document at a time.
 *
 * The query must define an `eligible` CTE with `batch_document_key` and
 * `batch_created_at` columns and bind the batch limit as `$1`. Documents are taken
 * oldest first until the limit is reached; the last document is never cut in half,
 * so a batch can run over the limit by up to one document's rows, and a document
 * larger than the limit still goes through whole.
 */
export const WHOLE_DOCUMENT_BATCH = `,
      documents AS (
        SELECT batch_document_key,
               MIN(batch_created_at) AS first_created_at,
               COUNT(*) AS row_count
          FROM eligible
         GROUP BY batch_document_key
      ),
      picked AS (
        SELECT batch_document_key
          FROM (
            SELECT batch_document_key,
                   SUM(row_count) OVER (ORDER BY first_created_at, batch_document_key) - row_count AS rows_before
              FROM documents
          ) ranked
         WHERE rows_before < $1
      )
      SELECT eligible.*
        FROM eligible
        JOIN picked USING (batch_document_key)`;
