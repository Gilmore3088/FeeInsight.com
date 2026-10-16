/** Fee rows only for exact selected peer IDs and optional verified account. No artificial averages. */
import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import type { PeerFeeEntry } from "@/lib/hamilton/peer-list";

export async function getPublishedPeerFees(ids: number[], category: string, db: typeof sql = sql): Promise<PeerFeeEntry[]> {
  if (!ids.length) return [];
  if (!(category in DISPLAY_NAMES)) throw new Error("Unknown fee category");
  if (ids.length > 51 || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid exact peer selection");
  const rows = await db.unsafe(
    `SELECT ef.id, ef.institution_id, ef.fee_name, ef.amount, ef.frequency,
            ef.created_at, ef.source_document_id, ef.document_url, ef.source_url
       FROM published_fee_catalog ef
      WHERE ef.institution_id = ANY($1::bigint[]) AND ef.fee_category = $2
        AND ef.review_status = 'approved' AND ${STATS_ROW_FILTER}
      ORDER BY ef.institution_id, ef.id LIMIT 501`,
    [ids, category],
  ) as Array<Record<string, unknown>>;
  if (rows.length > 500) throw new Error("Too many distinct published fee rows; narrow the selection");
  const safeUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  return rows.map(row => {
    const institutionId = Number(row.institution_id), id = Number(row.id);
    const amount = row.amount === null ? null : Number(row.amount);
    if (!ids.includes(institutionId) || !Number.isSafeInteger(id) || id <= 0 ||
        (amount !== null && (!Number.isFinite(amount) || amount < 0))) throw new Error("Invalid published fee evidence");
    const rawDate = row.created_at;
    const publishedAt = rawDate instanceof Date ? rawDate.toISOString() : typeof rawDate === "string" ? rawDate : null;
    const sourceDocumentId = row.source_document_id === null ? null : Number(row.source_document_id);
    return {
      institutionId, id, name: typeof row.fee_name === "string" ? row.fee_name : DISPLAY_NAMES[category],
      amount, frequency: typeof row.frequency === "string" ? row.frequency : null, publishedAt,
      sourceDocumentId: sourceDocumentId !== null && Number.isSafeInteger(sourceDocumentId) ? sourceDocumentId : null,
      documentUrl: safeUrl(row.document_url), sourceUrl: safeUrl(row.source_url),
    };
  });
}
