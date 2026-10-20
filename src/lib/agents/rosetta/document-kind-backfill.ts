import type { sql } from "@/lib/data-store/connection";
import { companionStreamsReady } from "@/lib/agents/companion-streams";
import { documentKind, DOCUMENT_KIND_VERSION, type DocumentKind } from "@/lib/agents/learning/document-kind";
import { documentKindColumnsReady } from "./table-rows";

type SqlTag = typeof sql;

/**
 * Stored texts classified per Rosetta read step. On 2026-10-20, 21,657 of 24,297 completed texts
 * had no kind: Rosetta decides the kind only when it reads a document (#1094), and every text
 * read before migration 050 (Oct 13) kept a null kind until its next read. 141 read steps a day
 * at this cap clear that backlog in about a day; a DOCUMENT_KIND_VERSION bump then re-decides
 * the old kinds the same way.
 */
export const DOCUMENT_KIND_BACKFILL_PER_RUN = 200;

export interface DocumentKindBackfill {
  classified: number;
  byKind: Partial<Record<DocumentKind, number>>;
}

/**
 * Decide the kind of completed texts that have none, or one from an older DOCUMENT_KIND_VERSION,
 * from their stored text, the same call a read makes (`recordReadResult`): a companion page is
 * not offered as the bank's fee link. Newest texts first. A text re-read since it was selected
 * (its hash changed) is left for that read's own kind.
 */
export async function backfillDocumentKinds(
  db: SqlTag,
  options: { dryRun: boolean; institutionId?: number; limit?: number },
): Promise<DocumentKindBackfill> {
  const empty: DocumentKindBackfill = { classified: 0, byKind: {} };
  if (options.dryRun || !(await documentKindColumnsReady(db))) return empty;
  const limit = Math.max(0, Math.floor(options.limit ?? DOCUMENT_KIND_BACKFILL_PER_RUN));
  if (limit === 0) return empty;
  const companions = await companionStreamsReady(db);
  const rows = await db<Array<{ id: number | string; normalized_text: string; source_url: string | null; text_hash: string | null; companion: boolean }>>`
    SELECT adt.id, adt.normalized_text, adt.source_url, adt.text_hash,
           ${companions ? db`sd.companion_source_id IS NOT NULL` : db`false`} AS companion
      FROM agent_source_texts adt
      ${companions ? db`LEFT JOIN source_documents sd ON sd.id = adt.source_document_id` : db``}
     WHERE adt.status = 'completed'
       AND adt.normalized_text IS NOT NULL
       AND adt.normalized_text <> ''
       AND (adt.document_kind IS NULL OR adt.document_kind_version IS DISTINCT FROM ${DOCUMENT_KIND_VERSION})
       ${options.institutionId ? db`AND adt.institution_id = ${options.institutionId}` : db``}
     ORDER BY adt.id DESC
     LIMIT ${limit}
  `;
  if (rows.length === 0) return empty;
  const decided = rows.map((row) => ({
    id: Number(row.id),
    hash: row.text_hash,
    kind: documentKind({ text: row.normalized_text, url: row.source_url, feeSchedule: !row.companion }).kind,
  }));
  const updated = await db<Array<{ kind: DocumentKind }>>`
    UPDATE agent_source_texts adt
       SET document_kind = decided.kind,
           document_kind_version = ${DOCUMENT_KIND_VERSION}
      FROM (
        SELECT unnest(${decided.map((row) => row.id)}::bigint[]) AS id,
               unnest(${decided.map((row) => row.kind)}::text[]) AS kind,
               unnest(${decided.map((row) => row.hash)}::text[]) AS text_hash
      ) decided
     WHERE adt.id = decided.id
       AND adt.status = 'completed'
       AND adt.text_hash IS NOT DISTINCT FROM decided.text_hash
       AND (adt.document_kind IS NULL OR adt.document_kind_version IS DISTINCT FROM ${DOCUMENT_KIND_VERSION})
    RETURNING decided.kind AS kind
  `;
  const byKind: Partial<Record<DocumentKind, number>> = {};
  for (const row of updated) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  return { classified: updated.length, byKind };
}
