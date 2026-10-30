import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";

/**
 * How much of one institution's fee schedule is on file, and how fresh it is (Hamilton V5 §4A
 * "source coverage indicator", #1891): the live published fees Hamilton compares (the same rows
 * `getInstitutionOwnFees` reads: approved, sourced, consumer-side, `STATS_ROW_FILTER`), the fee
 * types they cover, the schedule documents they were read from with each document's own stated
 * date (`source_documents.stated_date`, #1878), and when the newest of them was verified against
 * its document (`verified_fee_observations.created_at`, the row the live fee is published from).
 * Read only; fee rows come from the published catalog alone.
 */
export interface InstitutionFeeCoverageRead {
  /** Live published fee rows. */
  fees: number;
  /** Their fee types (canonical categories), sorted. */
  categories: string[];
  /** One entry per schedule document behind those rows. */
  documents: { id: number; statedDate: string | null; statedBasis: string | null }[];
  /** When the most recently verified live fee was verified; null when none records it. */
  lastVerifiedAt: string | null;
}

function isoDay(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}

function isoTime(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export async function getInstitutionFeeCoverage(institutionId: number): Promise<InstitutionFeeCoverageRead> {
  const [row] = await sql.unsafe(
    `WITH live AS (
       SELECT ef.fee_category, ef.source_document_id, ef.fee_verified_id
         FROM published_fee_catalog ef
        WHERE ef.institution_id = $1
          AND ef.fee_category IS NOT NULL
          AND ef.review_status = 'approved'
          AND ${STATS_ROW_FILTER}
     )
     SELECT
       (SELECT COUNT(*)::int FROM live) AS fees,
       (SELECT COALESCE(array_agg(DISTINCT fee_category ORDER BY fee_category), '{}') FROM live) AS categories,
       (SELECT MAX(fv.created_at)
          FROM live JOIN verified_fee_observations fv ON fv.fee_verified_id = live.fee_verified_id) AS last_verified_at,
       (SELECT COALESCE(json_agg(json_build_object('id', doc.id, 'stated_date', doc.stated_date, 'stated_basis', doc.stated_date_basis) ORDER BY doc.id), '[]'::json)
          FROM source_documents doc
         WHERE doc.institution_id = $1
           AND doc.id IN (SELECT DISTINCT source_document_id FROM live)) AS documents`,
    [institutionId] as never[],
  ) as {
    fees: number | string;
    categories: string[] | null;
    last_verified_at: Date | string | null;
    documents: { id: number | string; stated_date: string | null; stated_basis: string | null }[] | string | null;
  }[];
  const docs = typeof row?.documents === "string" ? JSON.parse(row.documents) : row?.documents ?? [];
  return {
    fees: Number(row?.fees ?? 0),
    categories: row?.categories ?? [],
    documents: (docs as { id: number | string; stated_date: string | null; stated_basis: string | null }[]).map((d) => ({
      id: Number(d.id),
      statedDate: isoDay(d.stated_date),
      statedBasis: d.stated_basis ?? null,
    })),
    lastVerifiedAt: isoTime(row?.last_verified_at ?? null),
  };
}
