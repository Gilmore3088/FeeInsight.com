import { sql } from "./connection";
import { readerFeeConditions } from "../fee-conditions";
import { summarizeFeesBy } from "./fee-stats";
import { VALID_US_CODES } from "../us-states";
import {
  classifyInstitutionQuality,
  getFeePublicationStatus,
  getInstitutionConfidenceSummary,
  getInstitutionInsightReadiness,
  getInstitutionSourceNeededReason,
  getPublicInstitutionQualityLabel,
} from "@/lib/institution-quality";
import type {
  CollectionStats,
  InstitutionSummary,
  ExtractedFee,
  InstitutionDetail,
} from "./types";
import { institutionDisplayName } from "@/lib/institution-display-name";

export interface PublicStats {
  total_observations: number;
  total_institutions: number;
  total_categories: number;
  total_states: number;
}

export async function getPublicStats(): Promise<PublicStats> {
  try {
    const validCodes = [...VALID_US_CODES];
    // The catalog rows are read once and each count runs over them. COUNT(DISTINCT row)
    // over all four at once sorted 64,000 row values on disk (1.2 s average, Oct 5-9).
    const [row] = await sql<PublicStats[]>`
      WITH live AS MATERIALIZED (
        SELECT ef.institution_id, ef.fee_name, ef.amount,
               COALESCE(ef.frequency, '') AS frequency, COALESCE(ef.variant_type, '') AS variant_type,
               ef.fee_category, ct.state_code
          FROM institution_sources ct
          JOIN published_fee_catalog ef ON ct.id = ef.institution_id
         WHERE ct.state_code IN ${sql(validCodes)}
           AND ef.review_status = 'approved'
      )
      SELECT
        (SELECT COUNT(*) FROM (SELECT DISTINCT institution_id, fee_name, amount, frequency, variant_type FROM live) o)
          as total_observations,
        (SELECT COUNT(DISTINCT institution_id) FROM live) as total_institutions,
        (SELECT COUNT(DISTINCT fee_category) FROM live) as total_categories,
        (SELECT COUNT(DISTINCT state_code) FROM live) as total_states`;
    return {
      total_observations: Number(row.total_observations),
      total_institutions: Number(row.total_institutions),
      total_categories: Number(row.total_categories),
      total_states: Number(row.total_states),
    };
  } catch {
    return { total_observations: 0, total_institutions: 0, total_categories: 0, total_states: 0 };
  }
}

export async function getStats(): Promise<CollectionStats> {
  const [total] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources`;
  const [banks] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources WHERE charter_type='bank'`;
  const [cus] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources WHERE charter_type='credit_union'`;
  const [withUrl] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources WHERE website_url IS NOT NULL`;
  const [withFee] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM institution_sources WHERE fee_schedule_url IS NOT NULL`;
  const [fees] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM published_fee_catalog`;
  const [runs] = await sql<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM source_collection_runs`;

  return {
    total_institutions: Number(total.cnt),
    banks: Number(banks.cnt),
    credit_unions: Number(cus.cnt),
    with_website: Number(withUrl.cnt),
    with_fee_url: Number(withFee.cnt),
    total_fees: Number(fees.cnt),
    collection_runs: Number(runs.cnt),
  };
}

export async function getInstitutionsWithFees(): Promise<InstitutionSummary[]> {
  return await sql<InstitutionSummary[]>`
    SELECT ct.id, ct.institution_name, ct.state_code, ct.charter_type,
           ct.asset_size, ct.website_url, ct.fee_schedule_url, ct.document_type,
           COUNT(ef.id) as fee_count
    FROM institution_sources ct
    LEFT JOIN published_fee_catalog ef ON ct.id = ef.institution_id
    WHERE ct.fee_schedule_url IS NOT NULL
    GROUP BY ct.id, ct.institution_name, ct.state_code, ct.charter_type,
             ct.asset_size, ct.website_url, ct.fee_schedule_url, ct.document_type
    ORDER BY ct.asset_size DESC NULLS LAST
  `;
}

export async function getFeesByInstitution(targetId: number): Promise<ExtractedFee[]> {
  const rows = await sql<ExtractedFee[]>`
    SELECT ef.id, ef.fee_name, ef.amount, ef.frequency, ef.conditions,
           ef.extraction_confidence, ef.review_status,
           ef.validation_flags, ef.fee_category, ef.fee_family,
           ef.source_url, ef.created_at,
           ct.institution_name, ef.institution_id
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.institution_id = ${targetId}
    ORDER BY ef.fee_name
  `;
  // Normalize numeric fields (Postgres NUMERIC/BIGINT returns strings)
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    institution_id: Number(r.institution_id),
    amount: r.amount !== null ? Number(r.amount) : null,
    extraction_confidence: Number(r.extraction_confidence),
    conditions: readerFeeConditions(r.conditions),
  }));
}

export async function getAllFees(
  limit = 100,
  offset = 0,
  search?: string,
): Promise<{ fees: ExtractedFee[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (search) {
    conditions.push(
      "(ef.fee_name ILIKE $" + (params.length + 1) +
      " OR ct.institution_name ILIKE $" + (params.length + 2) + ")"
    );
    params.push(`%${search}%`, `%${search}%`);
  }

  const where =
    conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const countResult = await sql.unsafe<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     ${where}`,
    params,
  );
  const cnt = Number(countResult[0].cnt);

  const feesParams = [...params, limit, offset];
  const fees = await sql.unsafe<ExtractedFee[]>(
    `SELECT ef.id, ef.fee_name, ef.amount, ef.frequency, ef.conditions,
           ef.extraction_confidence, ef.review_status,
           ct.institution_name, ef.institution_id
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    ${where}
    ORDER BY ct.institution_name, ef.fee_name
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    feesParams,
  );

  return { fees, total: cnt };
}

export async function getInstitutionsByFilter(filters: {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  state_code?: string;
  /** Exact city name, case-insensitive. */
  city?: string;
  gap?: boolean;
  /** Only institutions with at least one published fee. */
  has_fees?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: InstitutionDetail[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (filters.charter_type) {
    conditions.push(`ct.charter_type = $${paramIdx++}`);
    params.push(filters.charter_type);
  }
  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => `$${paramIdx++}`).join(",");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }
  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts.map(() => `$${paramIdx++}`).join(",");
    conditions.push(`ct.fed_district IN (${placeholders})`);
    params.push(...filters.fed_districts);
  }
  if (filters.state_code) {
    conditions.push(`ct.state_code = $${paramIdx++}`);
    params.push(filters.state_code);
  }
  if (filters.city) {
    conditions.push(`LOWER(ct.city) = LOWER($${paramIdx++})`);
    params.push(filters.city);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const having = filters.gap
    ? "HAVING COUNT(ef.id) = 0"
    : filters.has_fees
      ? "HAVING COUNT(ef.id) > 0"
      : "";

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const countResult = await sql.unsafe<{ cnt: number }[]>(`
    SELECT COUNT(*) as cnt FROM (
      SELECT ct.id
      FROM institution_sources ct
      LEFT JOIN published_fee_catalog ef ON ct.id = ef.institution_id
        AND ef.review_status != 'rejected'
      ${where}
      GROUP BY ct.id
      ${having}
    ) sub
  `, params);

  const limitParam = `$${paramIdx++}`;
  const offsetParam = `$${paramIdx++}`;
  const rows = await sql.unsafe<InstitutionDetail[]>(`
    SELECT ct.id, ct.institution_name, ct.state_code, ct.charter_type,
           ct.asset_size, ct.asset_size_tier, ct.fed_district, ct.city,
           ct.website_url, ct.fee_schedule_url,
           COUNT(ef.id) as fee_count
    FROM institution_sources ct
    LEFT JOIN published_fee_catalog ef ON ct.id = ef.institution_id
      AND ef.review_status != 'rejected'
    ${where}
    GROUP BY ct.id, ct.institution_name, ct.state_code, ct.charter_type,
             ct.asset_size, ct.asset_size_tier, ct.fed_district, ct.city,
             ct.website_url, ct.fee_schedule_url
    ${having}
    ORDER BY ct.asset_size DESC NULLS LAST
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `, [...params, pageSize, offset]);

  return { rows, total: Number(countResult[0].cnt) };
}

export async function getInstitutionById(id: number): Promise<InstitutionDetail | null> {
  const [row] = await sql<(InstitutionDetail & {
    latest_source_error?: string | null;
    latest_source_collected_at?: string | Date | null;
  })[]>`
    WITH catalog_counts AS (
      SELECT
        institution_id,
        COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count,
        COUNT(*) FILTER (WHERE review_status <> 'approved' AND review_status <> 'rejected')::int AS catalog_provisional_fee_count,
        COUNT(*) FILTER (WHERE review_status <> 'rejected')::int AS visible_fee_count
      FROM published_fee_catalog
      WHERE institution_id = ${id}
      GROUP BY institution_id
    ),
    verified_unpublished_counts AS (
      SELECT
        fv.institution_id,
        COUNT(*)::int AS verified_unpublished_fee_count
      FROM verified_fee_observations fv
      WHERE fv.institution_id = ${id}
        AND fv.review_status <> 'rejected'
        AND NOT EXISTS (
          SELECT 1
          FROM published_fee_catalog pfc
          WHERE pfc.fee_verified_id = fv.fee_verified_id
            AND pfc.review_status <> 'rejected'
        )
      GROUP BY fv.institution_id
    ),
    raw_unverified_counts AS (
      SELECT
        fr.institution_id,
        COUNT(*)::int AS raw_unverified_fee_count
      FROM raw_fee_observations fr
      WHERE fr.institution_id = ${id}
        AND NOT EXISTS (
          SELECT 1
          FROM verified_fee_observations fv
          WHERE fv.fee_raw_id = fr.fee_raw_id
            AND fv.review_status <> 'rejected'
        )
      GROUP BY fr.institution_id
    ),
    latest_docs AS (
      SELECT DISTINCT ON (institution_id)
        institution_id,
        status AS latest_source_status,
        COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count,
        error_message AS latest_source_error,
        crawled_at AS latest_source_collected_at
      FROM source_documents
      WHERE institution_id = ${id}
      ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
    )
    SELECT ct.id, ct.institution_name, ct.state_code, ct.charter_type,
           ct.asset_size, ct.asset_size_tier, ct.fed_district, ct.city,
           ct.source, ct.cert_number, ct.rssd_id, ct.lei, ct.document_type,
           ct.website_url, ct.fee_schedule_url,
           (
             COALESCE(cc.visible_fee_count, 0)
             + COALESCE(vuc.verified_unpublished_fee_count, 0)
             + COALESCE(ruc.raw_unverified_fee_count, 0)
           ) as fee_count,
           COALESCE(cc.published_fee_count, 0) as published_fee_count,
           (
             COALESCE(cc.catalog_provisional_fee_count, 0)
             + COALESCE(vuc.verified_unpublished_fee_count, 0)
             + COALESCE(ruc.raw_unverified_fee_count, 0)
           ) as provisional_fee_count,
           ld.latest_source_status,
           COALESCE(ld.latest_extracted_fee_count, 0) as latest_extracted_fee_count,
           ld.latest_source_error,
           ld.latest_source_collected_at
    FROM institution_sources ct
    LEFT JOIN catalog_counts cc ON cc.institution_id = ct.id
    LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
    LEFT JOIN raw_unverified_counts ruc ON ruc.institution_id = ct.id
    LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
    WHERE ct.id = ${id}
  `;
  if (!row) return null;
  return mapInstitutionDetailRow(row);
}

export async function getPublicInstitutionById(id: number): Promise<InstitutionDetail | null> {
  const [row] = await sql<(InstitutionDetail & {
    latest_source_error?: string | null;
    latest_source_collected_at?: string | Date | null;
  })[]>`
    WITH catalog_counts AS (
      SELECT
        institution_id,
        COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count,
        COUNT(*) FILTER (WHERE review_status <> 'approved' AND review_status <> 'rejected')::int AS catalog_provisional_fee_count,
        COUNT(*) FILTER (WHERE review_status <> 'rejected')::int AS visible_fee_count
      FROM published_fee_catalog
      WHERE institution_id = ${id}
      GROUP BY institution_id
    ),
    latest_docs AS (
      SELECT DISTINCT ON (institution_id)
        institution_id,
        status AS latest_source_status,
        COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count,
        error_message AS latest_source_error,
        crawled_at AS latest_source_collected_at
      FROM source_documents
      WHERE institution_id = ${id}
      ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
    )
    SELECT ct.id, ct.institution_name, ct.state_code, ct.charter_type,
           ct.asset_size, ct.asset_size_tier, ct.fed_district, ct.city,
           ct.source, ct.cert_number, ct.rssd_id, ct.lei, ct.document_type,
           ct.website_url, ct.fee_schedule_url,
           COALESCE(cc.visible_fee_count, 0) as fee_count,
           COALESCE(cc.published_fee_count, 0) as published_fee_count,
           COALESCE(cc.catalog_provisional_fee_count, 0) as provisional_fee_count,
           ld.latest_source_status,
           COALESCE(ld.latest_extracted_fee_count, 0) as latest_extracted_fee_count,
           ld.latest_source_error,
           ld.latest_source_collected_at
    FROM institution_sources ct
    LEFT JOIN catalog_counts cc ON cc.institution_id = ct.id
    LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
    WHERE ct.id = ${id}
  `;
  if (!row) return null;
  return mapInstitutionDetailRow(row);
}

export async function getInstitutionMetadataById(
  id: number,
): Promise<Pick<
  InstitutionDetail,
  "id" | "institution_name" | "state_code" | "charter_type"
> | null> {
  const [row] = await sql<Array<{
    id: number | string;
    institution_name: string;
    state_code: string | null;
    charter_type: string;
  }>>`
    SELECT id, institution_name, state_code, charter_type
    FROM institution_sources
    WHERE id = ${id}
  `;

  if (!row) return null;
  return {
    id: Number(row.id),
    institution_name: institutionDisplayName(row.institution_name),
    state_code: row.state_code,
    charter_type: row.charter_type,
  };
}

function mapInstitutionDetailRow(row: InstitutionDetail & {
  latest_source_error?: string | null;
  latest_source_collected_at?: string | Date | null;
}): InstitutionDetail {
  const latestSourceCollectedAtRaw: unknown = row.latest_source_collected_at;
  const latestSourceCollectedAt =
    latestSourceCollectedAtRaw instanceof Date
      ? latestSourceCollectedAtRaw.toISOString()
      : latestSourceCollectedAtRaw
        ? String(latestSourceCollectedAtRaw)
        : null;
  const visibleFeeCount = Number(row.fee_count ?? 0);
  const publishedFeeCount = Number(row.published_fee_count ?? 0);
  const provisionalFeeCount = Number(row.provisional_fee_count ?? 0);
  const latestExtractedFeeCount = Number(row.latest_extracted_fee_count ?? 0);
  const quality = classifyInstitutionQuality({
    source: row.source ?? null,
    certNumber: row.cert_number ?? null,
    rssdId: row.rssd_id ?? null,
    lei: row.lei ?? null,
    websiteUrl: row.website_url,
    feeScheduleUrl: row.fee_schedule_url,
    publishedFeeCount,
    latestSourceStatus: row.latest_source_status ?? null,
    latestExtractedFeeCount,
    latestSourceError: row.latest_source_error ?? null,
    latestSourceCollectedAt,
  });
  const feePublicationStatus = getFeePublicationStatus({
    publishedFeeCount,
    provisionalFeeCount,
    latestExtractedFeeCount,
    latestSourceStatus: row.latest_source_status ?? null,
    feeScheduleUrl: row.fee_schedule_url,
  });
  const readinessInput = {
    publishedFeeCount,
    provisionalFeeCount,
    latestExtractedFeeCount,
    latestSourceStatus: row.latest_source_status ?? null,
    feeScheduleUrl: row.fee_schedule_url,
    feePublicationStatus,
  };
  return {
    ...row,
    id: Number(row.id),
    asset_size: row.asset_size !== null ? Number(row.asset_size) : null,
    fed_district: row.fed_district !== null ? Number(row.fed_district) : null,
    fee_count: visibleFeeCount,
    published_fee_count: publishedFeeCount,
    provisional_fee_count: provisionalFeeCount,
    fee_publication_status: feePublicationStatus,
    insight_readiness: getInstitutionInsightReadiness(readinessInput),
    source_needed_reason: getInstitutionSourceNeededReason(readinessInput),
    confidence_summary: getInstitutionConfidenceSummary(readinessInput),
    latest_extracted_fee_count: latestExtractedFeeCount,
    latest_source_collected_at: latestSourceCollectedAt,
    quality_status: quality.quality_status,
    quality_signals: quality.quality_signals,
    quality_label: getPublicInstitutionQualityLabel(quality.quality_signals),
  };
}

export async function getPeerAnalysis(targetId: number): Promise<Record<string, unknown> | null> {
  const [row] = await sql<{ result_json: string | Record<string, unknown> }[]>`
    SELECT result_json FROM institution_analysis_results
    WHERE institution_id = ${targetId} AND analysis_type = 'peer_comparison'
  `;
  if (!row) return null;
  // Postgres JSONB returns parsed object; TEXT returns string
  if (typeof row.result_json === "object") return row.result_json as Record<string, unknown>;
  return JSON.parse(row.result_json);
}

export async function getTierCounts(): Promise<{ tier: string; count: number }[]> {
  const rows = await sql<{ tier: string; count: number }[]>`
    SELECT asset_size_tier as tier, COUNT(*) as count
    FROM institution_sources
    WHERE asset_size_tier IS NOT NULL
    GROUP BY asset_size_tier
    ORDER BY MIN(asset_size)
  `;
  return rows.map(r => ({ ...r, count: Number(r.count) }));
}

export async function getDistrictCounts(): Promise<{ district: number; count: number }[]> {
  const rows = await sql<{ district: number; count: number }[]>`
    SELECT fed_district as district, COUNT(*) as count
    FROM institution_sources
    WHERE fed_district IS NOT NULL
    GROUP BY fed_district
    ORDER BY fed_district
  `;
  return rows.map(r => ({ ...r, count: Number(r.count) }));
}

export async function getDistinctFeeTypes(): Promise<string[]> {
  const rows = await sql<{ fee_name: string }[]>`
    SELECT DISTINCT fee_name FROM published_fee_catalog ORDER BY fee_name
  `;
  return rows.map((r) => r.fee_name);
}

export interface CategoryMedian {
  median: number;
  p25: number;
  p75: number;
  count: number;
}

export async function getCategoryMedians(): Promise<Record<string, CategoryMedian>> {
  const rows = await sql<{ fee_category: string; amount: number; institution_id: number }[]>`
    SELECT fee_category, amount, institution_id
    FROM published_fee_catalog
    WHERE fee_category IS NOT NULL
      AND amount IS NOT NULL
      AND source_document_id IS NOT NULL
  `;

  const result: Record<string, CategoryMedian> = {};
  for (const [category, stats] of summarizeFeesBy(rows, (row) => row.fee_category)) {
    if (stats.median_amount === null || stats.p25_amount === null || stats.p75_amount === null) continue;
    result[category] = {
      median: stats.median_amount,
      p25: stats.p25_amount,
      p75: stats.p75_amount,
      count: stats.institution_count,
    };
  }

  return result;
}

export interface DataFreshness {
  last_crawl_at: string | null;
  last_fee_extracted_at: string | null;
  total_observations: number;
}

export async function getDataFreshness(): Promise<DataFreshness> {
  const [crawl] = await sql<{ last_at: string | Date | null }[]>`
    SELECT MAX(crawled_at) as last_at FROM source_documents WHERE status = 'success'
  `;

  // One pass over the catalog view for both figures; each used to cost its own (~200 ms).
  const [fee] = await sql<{ last_at: string | Date | null; cnt: number }[]>`
    SELECT MAX(created_at) as last_at, COUNT(*) as cnt FROM published_fee_catalog
    WHERE review_status = 'approved'
  `;

  // Normalize Date objects (Postgres) to ISO strings
  const normDate = (v: string | Date | null | undefined): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  return {
    last_crawl_at: normDate(crawl?.last_at),
    last_fee_extracted_at: normDate(fee?.last_at),
    total_observations: Number(fee.cnt),
  };
}
