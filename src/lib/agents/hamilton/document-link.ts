import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * #1347: the link a fee carries is the page its document's stored text was read from. That is
 * usually the document's own URL, but not always: Rosetta reads the schedule PDF a landing page
 * links to, or a redirect's target, and keeps that address on the text
 * (`agent_source_texts.source_url`). Knox copies the text's address to the fee, which is right.
 * The address is the text's when that text is completed and has an http(s) address, otherwise
 * the document's own URL.
 */
export function documentLinkSql(documentAlias: string, textAlias: string): string {
  return `COALESCE(
    CASE WHEN ${textAlias}.status = 'completed' AND btrim(${textAlias}.source_url) ~* '^https?://' THEN btrim(${textAlias}.source_url) END,
    CASE WHEN btrim(${documentAlias}.document_url) ~* '^https?://' THEN btrim(${documentAlias}.document_url) END
  )`;
}

/**
 * #1347 prevent: a step that moves a fee's raw row to another document (the identical-copy move,
 * the source check's relink of an imported fee) gives the fee that document's link at every tier
 * in the same transaction, so the link never names the document the row left. Rows whose new
 * document has no link keep theirs. Returns the published rows whose link changed.
 */
export async function pointFeeLinksAtDocument(scope: SqlTag, feeRawIds: number[]): Promise<number> {
  if (feeRawIds.length === 0) return 0;
  // The link expression is `documentLinkSql("sd", "ast")`, written out so the ids stay a parameter.
  const changed = await scope<{ fee_published_id: number | string }[]>`
    WITH target AS (
      SELECT fr.fee_raw_id,
             COALESCE(
               CASE WHEN ast.status = 'completed' AND btrim(ast.source_url) ~* '^https?://' THEN btrim(ast.source_url) END,
               CASE WHEN btrim(sd.document_url) ~* '^https?://' THEN btrim(sd.document_url) END
             ) AS url
        FROM raw_fee_observations fr
        JOIN source_documents sd ON sd.id = fr.source_document_id
        LEFT JOIN agent_source_texts ast ON ast.source_document_id = sd.id
       WHERE fr.fee_raw_id = ANY(${feeRawIds}::bigint[])
    ), raw AS (
      UPDATE raw_fee_observations fr
         SET source_url = target.url
        FROM target
       WHERE fr.fee_raw_id = target.fee_raw_id
         AND target.url IS NOT NULL
         AND fr.source_url IS DISTINCT FROM target.url
      RETURNING fr.fee_raw_id
    ), verified AS (
      UPDATE verified_fee_observations fv
         SET source_url = target.url
        FROM target
       WHERE fv.fee_raw_id = target.fee_raw_id
         AND target.url IS NOT NULL
         AND fv.source_url IS DISTINCT FROM target.url
      RETURNING fv.fee_verified_id
    )
    UPDATE published_fee_records fp
       SET source_url = target.url
      FROM verified_fee_observations fv
      JOIN target ON target.fee_raw_id = fv.fee_raw_id
     WHERE fp.lineage_ref = fv.fee_verified_id
       AND target.url IS NOT NULL
       AND fp.source_url IS DISTINCT FROM target.url
    RETURNING fp.fee_published_id
  `;
  return changed.length;
}
