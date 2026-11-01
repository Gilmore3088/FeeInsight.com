import { sql } from "./connection";
import type { GoldenMember } from "@/lib/agents/deming/golden-set";

type SqlTag = typeof sql;

/**
 * Read-only: the stored text of each golden answer-key bank's reference document, found by the
 * institution and the exact content hash the member froze (#2533). A bank whose document has no
 * completed stored text maps to null and stays unmeasured; nothing is fetched and nothing written.
 */
export async function loadAnswerKeyBankTexts(members: readonly GoldenMember[], db: SqlTag = sql): Promise<Map<string, string | null>> {
  const banks = members.flatMap((member) => (member.kind === "answer_key_bank" ? [member] : []));
  const texts = new Map<string, string | null>(banks.map((bank) => [bank.id, null]));
  if (banks.length === 0) return texts;
  const rows = await db<Array<{ institution_id: number | string; content_hash: string; normalized_text: string | null }>>`
    SELECT DISTINCT ON (d.institution_id, lower(d.content_hash)) d.institution_id, lower(d.content_hash) AS content_hash, t.normalized_text
      FROM source_documents d
      JOIN agent_source_texts t ON t.source_document_id = d.id
     WHERE d.institution_id = ANY(${banks.map((bank) => bank.institutionId)}::bigint[])
       AND lower(d.content_hash) = ANY(${banks.map((bank) => bank.contentHash.toLowerCase())}::text[])
       AND t.status = 'completed' AND t.normalized_text IS NOT NULL
     ORDER BY d.institution_id, lower(d.content_hash), t.updated_at DESC, t.id DESC`;
  for (const bank of banks) {
    const row = rows.find((r) => Number(r.institution_id) === bank.institutionId && r.content_hash === bank.contentHash.toLowerCase());
    texts.set(bank.id, row?.normalized_text ?? null);
  }
  return texts;
}
