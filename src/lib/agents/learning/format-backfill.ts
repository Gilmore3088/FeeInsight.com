import type { sql } from "@/lib/data-store/connection";

import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/** Profiles given a format per read step; later steps pick up the rest. */
export const FORMAT_BACKFILL_LIMIT = 500;

export interface FormatBackfill {
  updated: number;
  byFormat: Record<string, number>;
}

/**
 * Fill in the learned `format` for institutions read before the learning core existed.
 * Their texts already say what the document was (PDF, scan, web page), but the
 * playbook was never told, so the institution page showed nothing and the router had
 * no format prior. Uses the institution's newest text that describes the fee schedule:
 * `wrong_document` texts are skipped because they describe the wrong page. Only empty
 * formats are filled; a learned format is never overwritten. Free and deterministic.
 */
export async function backfillPlaybookFormats(
  db: SqlTag,
  options: { dryRun: boolean; institutionId?: number },
): Promise<FormatBackfill> {
  const params: Array<number | string> = [FORMAT_BACKFILL_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND adt.institution_id = $${params.length}`;
  }
  const learned = `
      SELECT DISTINCT ON (adt.institution_id)
             adt.institution_id,
             CASE
               WHEN adt.status = 'needs_ocr' THEN 'pdf_scanned'
               WHEN adt.document_type = 'pdf' THEN 'pdf_text'
               WHEN adt.document_type = 'html' AND adt.status = 'empty' THEN 'html_js'
               WHEN adt.document_type = 'html' THEN 'html_static'
               WHEN adt.document_type = 'docx' THEN 'docx'
               WHEN adt.document_type = 'text' THEN 'text'
             END AS format
        FROM agent_source_texts adt
        JOIN institution_source_profiles profile
          ON profile.institution_id = adt.institution_id AND profile.format IS NULL
       WHERE adt.status IN ('completed', 'needs_ocr', 'empty')
         AND adt.document_type IN ('pdf', 'html', 'docx', 'text')
         ${institutionFilter}
       ORDER BY adt.institution_id, adt.id DESC`;

  let rows: Array<{ format: string }>;
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<Array<{ format: string }>>(`SELECT format FROM (${learned}) learned LIMIT $1`, params);
      }
      return scope.unsafe<Array<{ format: string }>>(
        `UPDATE institution_source_profiles profile
            SET format = learned.format,
                last_learned_at = COALESCE(profile.last_learned_at, NOW()),
                updated_at = NOW()
           FROM (SELECT * FROM (${learned}) ranked LIMIT $1) learned
          WHERE profile.institution_id = learned.institution_id
            AND profile.format IS NULL
        RETURNING profile.format`,
        params,
      );
    });
  } catch (error) {
    // Filling in notes must never block reading new documents.
    console.error("backfillPlaybookFormats failed:", error);
    return { updated: 0, byFormat: {} };
  }

  const byFormat: Record<string, number> = {};
  for (const row of rows) byFormat[row.format] = (byFormat[row.format] ?? 0) + 1;
  return { updated: rows.length, byFormat };
}
