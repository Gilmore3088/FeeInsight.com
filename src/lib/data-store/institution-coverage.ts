import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import { STATED_DATE_VERSION } from "@/lib/agents/magellan/stated-date";

/**
 * How much of one institution's fee schedule is on file, and how fresh it is (Hamilton V5 §4A
 * "source coverage indicator", #1891): the live published fees Hamilton compares (the same rows
 * `getInstitutionOwnFees` reads: approved, sourced, consumer-side, `STATS_ROW_FILTER`), the fee
 * types they cover, the schedule documents they were read from with each document's own stated
 * date (`source_documents.stated_date`, #1878), and when the most recently verified of them was
 * first verified against its document (`verified_fee_observations.created_at`, the row the live
 * fee is published from). Read only; fee rows come from the published catalog alone.
 *
 * `stated_date` is null both when a document states no date and when its date has not been read
 * yet (migration 20270110000077 added the columns with no backfill), so a document counts as read
 * only at `stated_date_version >= STATED_DATE_VERSION` (the version Darwin's dated-edition check
 * and Magellan's freshness search require); `statedRead` false means "not read yet", never "no date".
 */
export interface InstitutionFeeCoverageRead {
  /** Live published fee rows. */
  fees: number;
  /** Their fee types (canonical categories), sorted. */
  categories: string[];
  /** One entry per schedule document behind those rows. */
  documents: { id: number; statedDate: string | null; statedBasis: string | null; statedRead: boolean }[];
  /** When the most recently verified live fee was first verified (its verified row's created_at); null when none records it. */
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

interface DocumentRow { id: number | string; stated_date: string | null; stated_basis: string | null; stated_version?: number | string | null }

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
       (SELECT COALESCE(json_agg(json_build_object('id', doc.id, 'stated_date', doc.stated_date, 'stated_basis', doc.stated_date_basis, 'stated_version', doc.stated_date_version) ORDER BY doc.id), '[]'::json)
          FROM source_documents doc
         WHERE doc.id IN (SELECT DISTINCT source_document_id FROM live)) AS documents`,
    [institutionId] as never[],
  ) as {
    fees: number | string;
    categories: string[] | null;
    last_verified_at: Date | string | null;
    documents: DocumentRow[] | string | null;
  }[];
  const docs = typeof row?.documents === "string" ? JSON.parse(row.documents) : row?.documents ?? [];
  return {
    fees: Number(row?.fees ?? 0),
    categories: row?.categories ?? [],
    documents: (docs as DocumentRow[]).map((d) => {
      const statedRead = d.stated_version !== null && d.stated_version !== undefined && Number(d.stated_version) >= STATED_DATE_VERSION;
      return {
        id: Number(d.id),
        statedDate: statedRead ? isoDay(d.stated_date) : null,
        statedBasis: statedRead ? d.stated_basis ?? null : null,
        statedRead,
      };
    }),
    lastVerifiedAt: isoTime(row?.last_verified_at ?? null),
  };
}
