import { sql } from "./connection";
import type { AssetEvidence, PeerListCriteria, PeerListRow, PeerListSubject } from "@/lib/hamilton/peer-list";

/**
 * Canonical FDIC/NCUA ingestion stores monetary fields in USD thousands:
 * regulatory/fdic.ts preserves ASSET; regulatory/ncua.ts divides ACCT_010 by 1,000.
 * Convert once in both SELECTs, before dollar criteria and presentation. The
 * existing financial.ts whole-dollar comment does not match these writers.
 * Never guess scale from an institution's asset magnitude.
 */
function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function date(value: unknown): string | null {
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "string" ? value.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}
/** Source links are optional. Never synthesize an institution-specific source URL. */
export function peerAssetSourceUrl(value: unknown, source: AssetEvidence["source"]): string | null {
  if (typeof value !== "string" || !source) return null;
  try {
    const u = new URL(value);
    const domain = source === "fdic" ? "fdic.gov" : "ncua.gov";
    return u.protocol === "https:" && !u.username && !u.password && (u.hostname === domain || u.hostname.endsWith(`.${domain}`)) ? u.href : null;
  } catch { return null; }
}
export function peerSubjectFromRow(row: Record<string, unknown>): PeerListSubject {
  const institutionId = Number(row.institution_id);
  if (!Number.isSafeInteger(institutionId) || institutionId <= 0 || typeof row.institution_name !== "string") throw new Error("Invalid peer institution record");
  const source = row.asset_source === "fdic" || row.asset_source === "ncua" ? row.asset_source : null;
  const reportDate = date(row.asset_report_date);
  const totalAssetsUsd = amount(row.total_assets_usd);
  // Invalid evidence must not appear as a dated, qualifying asset figure.
  if (totalAssetsUsd !== null && (!source || !reportDate)) throw new Error("Asset record lacks a valid source or reporting date");
  return {
    institutionId, name: row.institution_name,
    charterType: row.charter_type === "bank" || row.charter_type === "credit_union" ? row.charter_type : null,
    city: typeof row.city === "string" ? row.city : null,
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    totalAssetsUsd, reportDate, source,
    sourceUrl: peerAssetSourceUrl(row.asset_source_url, source),
    recordId: amount(row.financial_record_id),
  };
}

export async function getPeerListSubject(institutionId: number, asOf: string, db: typeof sql = sql): Promise<PeerListSubject | null> {
  const rows = await db`
    SELECT inst.id AS institution_id, inst.institution_name, inst.charter_type, inst.city, inst.state_code,
           f.id AS financial_record_id, (f.total_assets::numeric * 1000) AS total_assets_usd,
           f.report_date AS asset_report_date, f.source AS asset_source, f.source_url AS asset_source_url
      FROM institution_sources inst
      LEFT JOIN LATERAL (
        SELECT id, total_assets, report_date, source, source_url
          FROM institution_financial_records
         WHERE institution_id = inst.id
           AND source = CASE WHEN inst.charter_type = 'credit_union' THEN 'ncua' ELSE 'fdic' END
           AND report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           AND report_date <= ${asOf}
         ORDER BY report_date DESC, fetched_at DESC NULLS LAST, id DESC LIMIT 1
      ) f ON TRUE
     WHERE inst.id = ${institutionId}`;
  return rows[0] ? peerSubjectFromRow(rows[0]) : null;
}

/** One statement: count and page share one snapshot; fee coverage is read only after selection. */
export async function getPeerListRows(subjectId: number, c: PeerListCriteria, asOf: string, db: typeof sql = sql): Promise<{ rows: PeerListRow[]; totalMatches: number }> {
  const rows = await db`
    WITH candidates AS (
      SELECT inst.id AS institution_id, inst.institution_name, inst.charter_type, inst.city, inst.state_code,
             f.id AS financial_record_id, (f.total_assets::numeric * 1000) AS total_assets_usd,
             f.report_date AS asset_report_date, f.source AS asset_source, f.source_url AS asset_source_url
        FROM institution_sources inst
        LEFT JOIN LATERAL (
          SELECT id, total_assets, report_date, source, source_url
            FROM institution_financial_records
           WHERE institution_id = inst.id
             AND source = CASE WHEN inst.charter_type = 'credit_union' THEN 'ncua' ELSE 'fdic' END
             AND report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             AND report_date <= ${asOf}
           ORDER BY report_date DESC, fetched_at DESC NULLS LAST, id DESC LIMIT 1
        ) f ON TRUE
       WHERE inst.id <> ${subjectId}
         AND inst.charter_type IN ('bank', 'credit_union')
         AND (${c.charterType}::text IS NULL OR inst.charter_type = ${c.charterType})
         AND (${c.states.length} = 0 OR inst.state_code = ANY(${c.states}::text[]))
         AND (${c.institutionIds === null} OR inst.id = ANY(${c.institutionIds ?? []}::bigint[]))
         AND (${c.assetTiers.length} = 0 OR inst.asset_size_tier = ANY(${c.assetTiers}::text[]))
         AND (${c.fedDistricts.length} = 0 OR inst.fed_district = ANY(${c.fedDistricts}::int[]))
    ), eligible AS (
      SELECT * FROM candidates
       WHERE (${!c.requiresAssets} OR (total_assets_usd IS NOT NULL AND total_assets_usd >= 0
              AND total_assets_usd::text NOT IN ('NaN', 'Infinity', '-Infinity')
              AND total_assets_usd <= 9007199254740991 AND TRUNC(total_assets_usd::numeric) = total_assets_usd))
         AND (${c.minAssets === null} OR
              (${c.minAssets?.inclusive ?? false} AND total_assets_usd >= ${c.minAssets?.value ?? null}::numeric) OR
              (${!(c.minAssets?.inclusive ?? false)} AND total_assets_usd > ${c.minAssets?.value ?? null}::numeric))
         AND (${c.maxAssets === null} OR
              (${c.maxAssets?.inclusive ?? false} AND total_assets_usd <= ${c.maxAssets?.value ?? null}::numeric) OR
              (${!(c.maxAssets?.inclusive ?? false)} AND total_assets_usd < ${c.maxAssets?.value ?? null}::numeric))
    ), selected AS (
      SELECT *, COUNT(*) OVER ()::int AS total_matches,
             ROW_NUMBER() OVER (ORDER BY
               CASE WHEN ${c.sort === "closest_assets"} THEN ABS(LN(NULLIF(total_assets_usd, 0) / NULLIF(${c.referenceAssetsUsd}::numeric, 0))) END ASC NULLS LAST,
               CASE WHEN ${c.sort === "largest_assets"} THEN total_assets_usd END DESC NULLS LAST,
               LOWER(institution_name), institution_id) AS selection_rank
        FROM eligible
       ORDER BY selection_rank LIMIT ${c.limit}
    )
    SELECT selected.*,
           (EXISTS (SELECT 1 FROM published_fee_catalog fee WHERE fee.institution_id = selected.institution_id)
             OR EXISTS (SELECT 1 FROM published_fee_rate_catalog rate WHERE rate.institution_id = selected.institution_id)) AS has_published_fees
      FROM selected ORDER BY selection_rank`;
  const mapped = rows.map((row) => ({
    ...peerSubjectFromRow(row),
    feeCoverage: row.has_published_fees === true ? "available" as const : "not_found" as const,
    inclusionReason: c.basis === "saved_peer_set" ? "Matches the saved group's filters and the stated criteria." : c.basis === "similar_assets" ? "Within the stated asset-size band and institution/state filters." : "Matches the stated institution, state and asset filters.",
  }));
  const totalMatches = rows[0] ? Number(rows[0].total_matches) : 0;
  if (!Number.isSafeInteger(totalMatches) || totalMatches < mapped.length) throw new Error("Invalid peer result count");
  return { rows: mapped, totalMatches };
}
