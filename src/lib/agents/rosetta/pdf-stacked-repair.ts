import { PDF_STACKED_REPAIR_VERSION } from "./reader-versions";
import type { sql } from "@/lib/data-store/connection";

export const PDF_STACKED_REPAIR_STRATEGY = "read.pdf_stacked_repair";

/** A rolling/older schema must skip this repair, not hide the ordinary lane backlog. */
export async function pdfStackedRepairSchemaReady(db: typeof sql): Promise<boolean> {
  const [row] = await db<Array<{ repair_schema_ready: boolean }>>`
    SELECT NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('source_documents', 'superseded_by_id'), ('source_documents', 'duplicate_of_id'),
        ('source_documents', 'companion_source_id'), ('source_documents', 'document_r2_key'),
        ('institution_additional_sources', 'account_name'),
        ('agent_source_texts', 'reader'), ('agent_source_texts', 'document_kind'),
        ('agent_source_texts', 'document_kind_version'),
        ('institution_source_profiles', 'do_not_retry'), ('institution_source_profiles', 'rejected_source_urls')
      ) expected(table_name, column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns actual
         WHERE actual.table_schema = 'public' AND actual.table_name = expected.table_name
           AND actual.column_name = expected.column_name
      )
    ) AND to_regclass('public.pipeline_feedback') IS NOT NULL
      AND to_regclass('public.pipeline_attempts') IS NOT NULL AS repair_schema_ready
  `;
  return row?.repair_schema_ready === true;
}

/** A bounded free read; it does not raise the general reader or prose replay floors. */
export const PDF_STACKED_REPAIR_MAX_PER_RUN = 4;

/** A successful check names the artifact it actually committed, not just a reader output. */
export function pdfStackedPersistedSql(text: string, attempt: string): string {
  for (const alias of [text, attempt]) if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid repair alias");
  return `(${attempt}.outcome = 'ok'
    AND COALESCE((${attempt}.detail->>'pdf_stacked')::int, 0) >= ${PDF_STACKED_REPAIR_VERSION}
    AND ${attempt}.detail->>'persisted_text_id' = ${text}.id::text
    AND ${attempt}.detail->>'persisted_text_hash' = ${text}.text_hash)`;
}

/** Unavailable/mismatched vault bytes keep the existing explicit operator-review exclusion. */
export function pdfStackedFailedReviewSql(attempt: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(attempt)) throw new Error("Invalid repair alias");
  return `(${attempt}.strategy = '${PDF_STACKED_REPAIR_STRATEGY}' AND ${attempt}.outcome <> 'ok'
    AND COALESCE((${attempt}.detail->>'pdf_stacked_requested')::int, 0) >= ${PDF_STACKED_REPAIR_VERSION}
    AND COALESCE(${attempt}.detail->>'pdf_stacked_rejected', 'false') <> 'true')`;
}

/**
 * Stored-text evidence of columns whose next-line bullet prices were interleaved.
 * Geometry in pdf-layout.ts still has to prove the independent columns. This cheap
 * witness only makes the current source bytes due for one free layout check.
 * The read owner, state readiness and Bayes all use the owner's complete selection.
 */
export function pdfStackedRepairDueSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid source-text alias");
  return `(
    ${alias}.status = 'completed'
    AND ${alias}.reader = 'read.pdf_layout'
    AND ${alias}.source_hash IS NOT NULL
    AND position(' | ' in ${alias}.normalized_text) > 0
    AND (SELECT COUNT(*) FROM regexp_matches(${alias}.normalized_text,
      '\\|[[:space:]]*[•*-][[:space:]]*\\$[[:space:]]*[0-9]', 'g')) >= 3
    AND (SELECT COUNT(*) FROM regexp_matches(${alias}.normalized_text,
      '(^|\\n)[[:space:]]*[•*-][[:space:]]*\\$[[:space:]]*[0-9]', 'g')) >= 3
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_attempts stacked_read
       WHERE stacked_read.stage = 'read'
         AND stacked_read.strategy IN ('read.pdf_layout', 'read.document_access', '${PDF_STACKED_REPAIR_STRATEGY}')
         AND stacked_read.institution_id = ${alias}.institution_id
         AND stacked_read.source_document_id = ${alias}.source_document_id
         AND stacked_read.input_fingerprint = ${alias}.source_hash
         AND (${pdfStackedPersistedSql(alias, "stacked_read")}
           OR ${pdfStackedFailedReviewSql("stacked_read")})
    )
  )`;
}
