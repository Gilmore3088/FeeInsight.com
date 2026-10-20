import { createHash } from "node:crypto";
import { getSql } from "./connection";
import { feeEvidence, type EvidenceFee, type FeeEvidence as MatchedPriceContext } from "@/lib/fee-evidence";
import { catalogContextStampSql, catalogRecordContext, type FeeRecordContext } from "./fee-record-context";

export interface SelectedTextArtifact {
  version: 1;
  id: number;
  institutionId: number;
  sourceDocumentId: number;
  status: "completed";
  /** Digest of the actual normalized text supplied to the matcher, not PDF bytes or a fresh GET. */
  textHash: string;
  recordedAt: string | null;
}
export interface FeeEvidence extends MatchedPriceContext {
  /** Optional for old cache entries; absence cannot bind a quote to displayed applicability. */
  context?: FeeRecordContext;
  text_artifact?: SelectedTextArtifact | null;
}

/** Most rows one call reads evidence for (a page lists 30; each row reads its document's text once). */
export const FEE_EVIDENCE_MAX_IDS = 100;

interface EvidenceRow extends EvidenceFee, Record<string, unknown> {
  id: number | string;
  source_document_id: number | string | null;
}

/**
 * Stored price context, keyed by catalog ID. The consistency stamp comes from the same SELECT
 * as every matcher input. Actual selected text identity is separate. A numerical/name match
 * does not verify product applicability or current-web freshness; callers must also bind the
 * displayed index price/institution/category to this receipt before showing its quote.
 */
export async function getFeeEvidence(ids: number[]): Promise<Map<number, FeeEvidence | null>> {
  const clean = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, FEE_EVIDENCE_MAX_IDS);
  if (clean.length === 0) return new Map();
  const sql = getSql();
  const rows = (await sql.unsafe(
    `SELECT ef.id, ef.institution_id, ef.fee_verified_id, ef.fee_raw_id, ef.fee_name, ef.amount, ef.fee_category,
            ef.extraction_note, ef.conditions, ef.source_document_id, ef.document_url, ef.source_url,
            ${catalogContextStampSql("ef")} AS context_stamp
       FROM published_fee_catalog ef
      WHERE ef.id = ANY($1::bigint[])`,
    [clean] as never[],
  )) as unknown as EvidenceRow[];
  const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const texts = new Map<string, { text: string; artifact: SelectedTextArtifact }>();
  if (documentIds.length > 0) {
    const textRows = (await sql.unsafe(
      `SELECT DISTINCT ON (ast.source_document_id, ast.institution_id)
              ast.id, ast.source_document_id, ast.institution_id, ast.normalized_text, ast.text_hash, ast.status,
              ast.created_at::text AS recorded_at
         FROM agent_source_texts ast
         JOIN source_documents sd ON sd.id = ast.source_document_id AND sd.institution_id = ast.institution_id
        WHERE ast.source_document_id = ANY($1::bigint[])
          AND ast.status = 'completed'
          AND ast.normalized_text IS NOT NULL
        ORDER BY ast.source_document_id, ast.institution_id, ast.id DESC`,
      [documentIds] as never[],
    )) as unknown as Array<{ id: number | string; source_document_id: number | string; institution_id: number | string; normalized_text: string; text_hash: string | null; status: string; recorded_at: string | null }>;
    for (const row of textRows) {
      const id = Number(row.id), sourceDocumentId = Number(row.source_document_id), institutionId = Number(row.institution_id);
      if (![id, sourceDocumentId, institutionId].every(n => Number.isSafeInteger(n) && n > 0) || row.status !== "completed" || typeof row.normalized_text !== "string") continue;
      const textHash = createHash("sha256").update(row.normalized_text).digest("hex");
      if (row.text_hash != null && row.text_hash !== textHash) continue;
      texts.set(`${institutionId}:${sourceDocumentId}`, { text: row.normalized_text,
        artifact: { version: 1, id, institutionId, sourceDocumentId, status: "completed", textHash, recordedAt: row.recorded_at } });
    }
  }
  return new Map(
    rows.map((row) => {
      const selected = texts.get(`${Number(row.institution_id)}:${Number(row.source_document_id)}`);
      const matched = feeEvidence(row, selected?.text);
      return [Number(row.id), matched ? { ...matched, context: catalogRecordContext(row), text_artifact: matched.basis === "traced" ? selected?.artifact ?? null : null } : null];
    }),
  );
}
