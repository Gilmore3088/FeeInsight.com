/** A consistency receipt for a selected catalog record, not verification or freshness. */
export interface FeeRecordContext {
  version: 1;
  stamp: string;
  publishedId: number;
  institutionId: number;
  category: string;
  amount: number | null;
  verifiedId: number | null;
  rawId: number | null;
  sourceDocumentId: number | null;
  documentUrl: string | null;
  sourceUrl: string | null;
}

/** Every pure matcher input and displayed applicability/source field. No later lookup can stamp it. */
const CONTEXT_COLUMNS = [
  "id", "fee_published_id", "institution_id", "fee_verified_id", "fee_raw_id", "fee_name", "fee_category", "amount",
  "frequency", "account_product_type", "conditions", "extraction_note", "fee_audience", "fee_treatment", "variant_type",
  "amount_kind", "rate_percent", "rate_min_amount", "rate_max_amount", "rate_basis", "source_document_id", "source_url",
  "document_url", "created_at",
] as const;

/** Static internal aliases only. Core PostgreSQL SHA-256; no extension, DDL or numeric JS round trip. */
export function catalogContextStampSql(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid catalog context alias");
  return `encode(sha256(convert_to(jsonb_build_array(${CONTEXT_COLUMNS.map(c => `${alias}.${c}`).join(", ")})::text, 'UTF8')), 'hex')`;
}

function positiveId(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
const text = (value: unknown): string | null => value == null ? null : String(value);

/** Missing pre-envelope cache/mock shapes stay unbound. Nullable lineage/source remains unknown. */
export function catalogRecordContext(row: Record<string, unknown>): FeeRecordContext | undefined {
  const publishedId = positiveId(row.id), institutionId = positiveId(row.institution_id);
  const category = text(row.fee_category), stamp = text(row.context_stamp);
  const amount = row.amount == null ? null : Number(row.amount);
  if (!publishedId || !institutionId || !category || !stamp || !/^[a-f0-9]{64}$/.test(stamp) || (amount !== null && !Number.isFinite(amount))) return undefined;
  if (["fee_verified_id", "fee_raw_id", "source_document_id"].some(key => row[key] !== null && positiveId(row[key]) === null)) return undefined;
  return {
    version: 1, stamp, publishedId, institutionId, category, amount,
    verifiedId: positiveId(row.fee_verified_id), rawId: positiveId(row.fee_raw_id), sourceDocumentId: positiveId(row.source_document_id),
    documentUrl: text(row.document_url), sourceUrl: text(row.source_url),
  };
}
