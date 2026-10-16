import { getSql } from "./connection";
import { feeEvidence, type EvidenceFee, type FeeEvidence } from "@/lib/fee-evidence";

export type { FeeEvidence };

/** Most rows one call reads evidence for (a page lists 30; each row reads its document's text once). */
export const FEE_EVIDENCE_MAX_IDS = 100;

interface EvidenceRow extends EvidenceFee {
  id: number | string;
  source_document_id: number | string | null;
}

/**
 * Each listed live fee's evidence (`feeEvidence`): the line of its own stored schedule that prints
 * its price, with the account heading above it, or null when no line shows the price, so a page
 * marks that fee unverified instead of quoting text without one. Keyed by `published_fee_catalog.id`.
 * Read-only: the row from the catalog, the text from its own document's latest completed read
 * (the text Hamilton's source check reads).
 */
export async function getFeeEvidence(ids: number[]): Promise<Map<number, FeeEvidence | null>> {
  const clean = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, FEE_EVIDENCE_MAX_IDS);
  if (clean.length === 0) return new Map();
  const sql = getSql();
  const rows = (await sql.unsafe(
    `SELECT ef.id, ef.fee_name, ef.amount, ef.fee_category, ef.extraction_note, ef.conditions, ef.source_document_id
       FROM published_fee_catalog ef
      WHERE ef.id = ANY($1::bigint[])`,
    [clean] as never[],
  )) as unknown as EvidenceRow[];
  const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const texts = new Map<number, string>();
  if (documentIds.length > 0) {
    const textRows = (await sql.unsafe(
      `SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
         FROM agent_source_texts
        WHERE source_document_id = ANY($1::bigint[])
          AND status = 'completed'
          AND normalized_text IS NOT NULL
        ORDER BY source_document_id, id DESC`,
      [documentIds] as never[],
    )) as unknown as Array<{ source_document_id: number | string; normalized_text: string }>;
    for (const row of textRows) texts.set(Number(row.source_document_id), row.normalized_text);
  }
  return new Map(
    rows.map((row) => [Number(row.id), feeEvidence(row, row.source_document_id == null ? null : texts.get(Number(row.source_document_id)))]),
  );
}
