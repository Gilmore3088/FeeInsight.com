import type { sql } from "@/lib/data-store/connection";
import type { LockedCurrentRawSourceResult } from "./locked-raw-source";
import { VerificationAudienceDeferred } from "./verification-audience";

type SqlTag = typeof sql;

/** A selected upstream attempt and complete actual raw tuple, never model authority. */
export interface SelectedPaidInput {
  selectedAttemptId?: number;
  selectedPolicyState?: string;
}

export interface PaidSourceInput {
  readonly documentId: number;
  readonly artifactId: number;
  readonly institutionId: number;
  readonly usedText: string;
  readonly documentState: string;
  readonly artifactState: string;
}

/** Observe the exact loaded bodies without acquiring locks before an external call. */
export async function capturePaidSourceInputs(
  db: SqlTag,
  texts: ReadonlyMap<number, string>,
): Promise<ReadonlyMap<number, PaidSourceInput>> {
  if (!texts.size) return new Map();
  const rows = await db<{
    source_document_id: number | string; artifact_id: number | string; institution_id: number | string;
    normalized_text: string; document_state: string; artifact_state: string;
  }[]>`/* paid_source_snapshot */
    SELECT DISTINCT ON (ast.source_document_id) ast.source_document_id, ast.id AS artifact_id,
           ast.institution_id, ast.normalized_text, to_jsonb(doc)::text AS document_state,
           to_jsonb(ast)::text AS artifact_state
      FROM agent_source_texts ast JOIN source_documents doc ON doc.id=ast.source_document_id
     WHERE ast.source_document_id=ANY(${[...texts.keys()]}::bigint[])
       AND ast.status='completed' AND ast.normalized_text IS NOT NULL
     ORDER BY ast.source_document_id, ast.id DESC`;
  return new Map(rows.flatMap(row => {
    const documentId = Number(row.source_document_id);
    const usedText = texts.get(documentId);
    // A concurrent change between the ordinary body read and this observation cannot
    // manufacture a snapshot for a body the actual call did not use.
    return usedText == null || row.normalized_text !== usedText ? [] : [[documentId, {
      documentId, artifactId: Number(row.artifact_id), institutionId: Number(row.institution_id),
      usedText, documentState: row.document_state, artifactState: row.artifact_state,
    }] as const];
  }));
}

/**
 * Called only after factual document→artifact→raw locks, inside the row savepoint.
 * No new source loader, original-Knox-hash requirement or price/category decision.
 */
export async function requireCurrentPaidInput(
  db: SqlTag,
  feeRawId: number,
  selection: SelectedPaidInput,
  context: Readonly<LockedCurrentRawSourceResult>,
  source: PaidSourceInput | undefined,
): Promise<void> {
  if (!source || context.kind !== "bound") throw new VerificationAudienceDeferred("paid_input:source_unavailable");
  const current = context.source;
  if (current.documentId !== source.documentId || current.artifactId !== source.artifactId ||
    current.institutionId !== source.institutionId || current.normalizedText !== source.usedText) {
    throw new VerificationAudienceDeferred("paid_input:source_changed");
  }
  if (!selection.selectedPolicyState || !Number.isSafeInteger(selection.selectedAttemptId) || selection.selectedAttemptId! <= 0) {
    throw new VerificationAudienceDeferred("paid_input:selection_unavailable");
  }
  try {
    const [row] = await db<{ state: string; document_state: string; artifact_state: string }[]>`/* paid_input_state */
      SELECT jsonb_build_array(to_jsonb(fr),to_jsonb(pa))::text AS state,
             to_jsonb(doc)::text AS document_state, to_jsonb(ast)::text AS artifact_state
        FROM raw_fee_observations fr JOIN pipeline_attempts pa ON pa.id=${selection.selectedAttemptId!}
        JOIN source_documents doc ON doc.id=${source.documentId}
        JOIN agent_source_texts ast ON ast.id=${source.artifactId} AND ast.source_document_id=doc.id
       WHERE fr.fee_raw_id=${feeRawId} AND fr.institution_id=${source.institutionId}
         AND fr.source_document_id=doc.id
       FOR SHARE OF pa NOWAIT`;
    if (!row || row.state !== selection.selectedPolicyState || row.document_state !== source.documentState ||
      row.artifact_state !== source.artifactState) throw new VerificationAudienceDeferred("paid_input:changed");
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "55P03" || code === "40001") throw new VerificationAudienceDeferred("paid_input:busy_or_changed");
    throw error;
  }
}
