import { sql } from "./connection";
import {
  classifyInstitutionQuality,
  getFeePublicationStatus,
  getFeePublicationStatusLabel,
  getInstitutionConfidenceSummary,
  getInstitutionInsightReadiness,
  getInstitutionSourceNeededReason,
  getPublicInstitutionQualityLabel,
  type FeePublicationStatus,
  type InstitutionInsightReadiness,
  type InstitutionQualityStatus,
  type InstitutionSourceNeededReason,
} from "@/lib/institution-quality";
import { institutionDisplayName } from "@/lib/institution-display-name";

export interface InstitutionSearchResult {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  fee_count: number;
  published_fee_count: number;
  provisional_fee_count: number;
  fee_publication_status: FeePublicationStatus;
  fee_publication_label: string;
  insight_readiness: InstitutionInsightReadiness;
  source_needed_reason: InstitutionSourceNeededReason;
  confidence_summary: string;
  quality_status: InstitutionQualityStatus;
  quality_label: string;
  /**
   * The institution's published amount for the requested fee category, when
   * `searchInstitutions` was called with one. `null` means the institution has no
   * published observation for that fee — never treat it as $0.
   */
  focus_fee_amount?: number | null;
  /** True when a fee category was requested, so callers can distinguish null from absent. */
  focus_fee_requested?: boolean;
}

export interface InstitutionStateDirectorySummary {
  state_code: string;
  institution_count: number;
  verified_institution_count: number;
  provisional_institution_count: number;
  under_review_institution_count: number;
  source_needed_institution_count: number;
  verified_fee_count: number;
  provisional_fee_count: number;
}

interface InstitutionSearchRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  asset_size: number | string | null;
  source: string | null;
  cert_number: string | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  fee_count: number | string;
  published_fee_count: number | string;
  provisional_fee_count: number | string;
  latest_source_status: string | null;
  latest_extracted_fee_count: number | string | null;
  latest_source_error: string | null;
  latest_source_collected_at: string | Date | null;
}

/**
 * Per-institution fee counts and latest source status, computed only for the
 * institutions in `scopeSql` (a SELECT returning one `id` column).
 *
 * Without the scope every caller aggregated the entire catalog, verified and raw
 * tiers and source documents, even an autocomplete that shows eight rows. Under
 * traffic those 30s+ scans held every pooled connection and stalled the public
 * site, so each caller now scopes to the rows it will actually return.
 */
function searchQualityCte(scopeSql: string): string {
  return `
  WITH scope AS (
    ${scopeSql}
  ),
  scope_catalog AS MATERIALIZED (
    -- Read the catalog view once for the scope. The view rebuilds its whole-catalog
    -- depth check on every reference, so the anti-join below used to recompute the
    -- entire catalog for each state page; a published row always carries its
    -- verified row's institution, so the scoped rows answer that check too.
    SELECT institution_id, fee_verified_id, review_status
    FROM published_fee_catalog
    WHERE institution_id IN (SELECT id FROM scope)
  ),
  scope_verified AS MATERIALIZED (
    -- Live verified rows for the scope, read once. A verified row always carries its
    -- raw row's institution, so the raw anti-join below can check against these rows
    -- instead of scanning every verified row in the country.
    SELECT institution_id, fee_verified_id, fee_raw_id
    FROM verified_fee_observations
    WHERE review_status <> 'rejected'
      AND institution_id IN (SELECT id FROM scope)
  ),
  catalog_counts AS (
    SELECT
      institution_id,
      COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count,
      COUNT(*) FILTER (WHERE review_status <> 'approved' AND review_status <> 'rejected')::int AS catalog_provisional_fee_count,
      COUNT(*) FILTER (WHERE review_status <> 'rejected')::int AS visible_fee_count
    FROM scope_catalog
    GROUP BY institution_id
  ),
  verified_unpublished_counts AS (
    SELECT
      fv.institution_id,
      COUNT(*)::int AS verified_unpublished_fee_count
    FROM scope_verified fv
    WHERE NOT EXISTS (
        SELECT 1
        FROM scope_catalog pfc
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
    WHERE fr.institution_id IN (SELECT id FROM scope)
      AND NOT EXISTS (
      SELECT 1
      FROM scope_verified fv
      WHERE fv.fee_raw_id = fr.fee_raw_id
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
    WHERE institution_id IN (SELECT id FROM scope)
    ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
  )
`;
}

function dateString(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapInstitutionSearchRow(row: InstitutionSearchRow): InstitutionSearchResult {
  const feeCount = Number(row.fee_count ?? 0);
  const publishedFeeCount = Number(row.published_fee_count ?? 0);
  const provisionalFeeCount = Number(row.provisional_fee_count ?? 0);
  const latestExtractedFeeCount = Number(row.latest_extracted_fee_count ?? 0);
  const quality = classifyInstitutionQuality({
    source: row.source,
    certNumber: row.cert_number,
    websiteUrl: row.website_url,
    feeScheduleUrl: row.fee_schedule_url,
    publishedFeeCount,
    latestSourceStatus: row.latest_source_status,
    latestExtractedFeeCount,
    latestSourceError: row.latest_source_error,
    latestSourceCollectedAt: dateString(row.latest_source_collected_at),
  });
  const publicationStatus = getFeePublicationStatus({
    publishedFeeCount,
    provisionalFeeCount,
    latestExtractedFeeCount,
    latestSourceStatus: row.latest_source_status,
    feeScheduleUrl: row.fee_schedule_url,
  });
  const readinessInput = {
    publishedFeeCount,
    provisionalFeeCount,
    latestExtractedFeeCount,
    latestSourceStatus: row.latest_source_status,
    feeScheduleUrl: row.fee_schedule_url,
    feePublicationStatus: publicationStatus,
  };

  return {
    id: Number(row.id),
    institution_name: institutionDisplayName(row.institution_name),
    city: row.city,
    state_code: row.state_code,
    charter_type: row.charter_type,
    asset_size_tier: row.asset_size_tier,
    asset_size: row.asset_size !== null ? Number(row.asset_size) : null,
    fee_count: feeCount,
    published_fee_count: publishedFeeCount,
    provisional_fee_count: provisionalFeeCount,
    fee_publication_status: publicationStatus,
    fee_publication_label: getFeePublicationStatusLabel(publicationStatus),
    insight_readiness: getInstitutionInsightReadiness(readinessInput),
    source_needed_reason: getInstitutionSourceNeededReason(readinessInput),
    confidence_summary: getInstitutionConfidenceSummary(readinessInput),
    quality_status: quality.quality_status,
    quality_label: getPublicInstitutionQualityLabel(quality.quality_signals),
  };
}

export async function searchInstitutions(params: {
  query?: string;
  state_code?: string;
  charter_type?: string;
  /**
   * Optional fee category to surface per institution. Additive: omitting it leaves the
   * directory's behaviour and result shape exactly as before.
   */
  fee_category?: string;
  /** Only meaningful alongside `fee_category`. Institutions without an observation sort last. */
  fee_sort?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}): Promise<{ rows: InstitutionSearchResult[]; total: number }> {
  const conditions: string[] = [];
  const queryParams: (string | number)[] = [];
  let paramIdx = 0;

  if (params.query && params.query.trim().length >= 2) {
    paramIdx++;
    conditions.push(`ct.institution_name ILIKE $${paramIdx}`);
    queryParams.push(`%${params.query.trim()}%`);
  }
  if (params.state_code) {
    paramIdx++;
    conditions.push(`ct.state_code = $${paramIdx}`);
    queryParams.push(params.state_code);
  }
  if (params.charter_type) {
    paramIdx++;
    conditions.push(`ct.charter_type = $${paramIdx}`);
    queryParams.push(params.charter_type);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const [countRow] = await sql.unsafe(
    `SELECT COUNT(*) as cnt FROM institution_sources ct ${where}`,
    queryParams
  ) as { cnt: number }[];

  // Optional fee-category focus. Reads through published_fee_catalog like every other
  // public fee read. LEFT JOIN so institutions without an observation still appear —
  // they are shown as "not published", never as $0.
  const focusCategory = params.fee_category?.trim() || null;
  let focusJoin = "";
  let focusSelect = "";
  if (focusCategory) {
    paramIdx++;
    focusJoin = `
     LEFT JOIN LATERAL (
       SELECT ef.amount
       FROM published_fee_catalog ef
       WHERE ef.institution_id = ct.id
         AND ef.fee_category = $${paramIdx}
         AND ef.review_status = 'approved'
         AND ef.amount IS NOT NULL
       ORDER BY ef.amount ASC
       LIMIT 1
     ) focus ON TRUE`;
    focusSelect = ",\n            focus.amount as focus_fee_amount";
    queryParams.push(focusCategory);
  }

  const orderBy =
    focusCategory && params.fee_sort
      ? `ORDER BY focus.amount ${params.fee_sort === "desc" ? "DESC" : "ASC"} NULLS LAST, ct.institution_name ASC`
      : "ORDER BY (COALESCE(cc.published_fee_count, 0) > 0) DESC, ct.institution_name ASC";

  paramIdx++;
  const limitParam = paramIdx;
  paramIdx++;
  const offsetParam = paramIdx;

  const rows = await sql.unsafe<InstitutionSearchRow[]>(
    `${searchQualityCte(`SELECT ct.id FROM institution_sources ct ${where}`)}
     SELECT ct.id, ct.institution_name, ct.city, ct.state_code,
            ct.charter_type, ct.asset_size_tier, ct.asset_size,
            ct.source, ct.cert_number, ct.website_url, ct.fee_schedule_url,
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
            ld.latest_source_collected_at${focusSelect}
     FROM institution_sources ct
     LEFT JOIN catalog_counts cc ON cc.institution_id = ct.id
     LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
     LEFT JOIN raw_unverified_counts ruc ON ruc.institution_id = ct.id
     LEFT JOIN latest_docs ld ON ld.institution_id = ct.id${focusJoin}
     ${where}
     ${orderBy}
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...queryParams, pageSize, offset]
  );

  return {
    rows: rows.map((row) => {
      const mapped = mapInstitutionSearchRow(row);
      if (!focusCategory) return mapped;
      const raw = (row as InstitutionSearchRow & { focus_fee_amount?: number | null })
        .focus_fee_amount;
      return {
        ...mapped,
        focus_fee_requested: true,
        focus_fee_amount: raw === null || raw === undefined ? null : Number(raw),
      };
    }),
    total: Number(countRow.cnt),
  };
}

export async function autocompleteInstitutions(query: string, limit = 8): Promise<InstitutionSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const term = query.trim();
  const pattern = `%${term}%`;
  const rows = await sql.unsafe<InstitutionSearchRow[]>(
    `${searchQualityCte("SELECT ct.id FROM institution_sources ct WHERE ct.institution_name ILIKE $1")}
    SELECT ct.id, ct.institution_name, ct.city, ct.state_code,
           ct.charter_type, ct.asset_size_tier, ct.asset_size,
           ct.source, ct.cert_number, ct.website_url, ct.fee_schedule_url,
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
    WHERE ct.institution_name ILIKE $1
    ORDER BY
      CASE
        WHEN lower(ct.institution_name) = lower($2) THEN 0
        WHEN lower(ct.institution_name) LIKE lower($2) || '%' THEN 1
        ELSE 2
      END,
      ct.asset_size DESC NULLS LAST,
      COALESCE(cc.published_fee_count, 0) DESC,
      (
        COALESCE(cc.catalog_provisional_fee_count, 0)
        + COALESCE(vuc.verified_unpublished_fee_count, 0)
        + COALESCE(ruc.raw_unverified_fee_count, 0)
      ) DESC,
      ct.institution_name ASC
    LIMIT $3`,
    [pattern, term, limit],
  );
  return rows.map(mapInstitutionSearchRow);
}

export async function getInstitutionStateDirectorySummaries(params: {
  charter_type?: string;
} = {}): Promise<InstitutionStateDirectorySummary[]> {
  const conditions = ["ct.state_code IS NOT NULL", "btrim(ct.state_code) <> ''"];
  const queryParams: string[] = [];

  if (params.charter_type) {
    queryParams.push(params.charter_type);
    conditions.push(`ct.charter_type = $${queryParams.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const rows = await sql.unsafe<{
    state_code: string;
    institution_count: number | string;
    verified_institution_count: number | string;
    provisional_institution_count: number | string;
    under_review_institution_count: number | string;
    source_needed_institution_count: number | string;
    verified_fee_count: number | string;
    provisional_fee_count: number | string;
  }[]>(
    `${searchQualityCte(`SELECT ct.id FROM institution_sources ct ${where}`)}
     SELECT
       per_institution.state_code,
       COUNT(*)::int AS institution_count,
       COUNT(*) FILTER (WHERE per_institution.published_fee_count > 0)::int AS verified_institution_count,
       COUNT(*) FILTER (
         WHERE per_institution.published_fee_count = 0
           AND per_institution.provisional_fee_count > 0
       )::int AS provisional_institution_count,
       COUNT(*) FILTER (
         WHERE per_institution.published_fee_count = 0
           AND per_institution.provisional_fee_count = 0
           AND (
             per_institution.latest_source_status IS NOT NULL
             OR btrim(COALESCE(per_institution.fee_schedule_url, '')) <> ''
           )
       )::int AS under_review_institution_count,
       COUNT(*) FILTER (
         WHERE per_institution.published_fee_count = 0
           AND per_institution.provisional_fee_count = 0
           AND per_institution.latest_source_status IS NULL
           AND btrim(COALESCE(per_institution.fee_schedule_url, '')) = ''
       )::int AS source_needed_institution_count,
       SUM(per_institution.published_fee_count)::int AS verified_fee_count,
       SUM(per_institution.provisional_fee_count)::int AS provisional_fee_count
     FROM (
       SELECT
         ct.id,
         ct.state_code,
         ct.fee_schedule_url,
         COALESCE(cc.published_fee_count, 0) AS published_fee_count,
         (
           COALESCE(cc.catalog_provisional_fee_count, 0)
           + COALESCE(vuc.verified_unpublished_fee_count, 0)
           + COALESCE(ruc.raw_unverified_fee_count, 0)
         ) AS provisional_fee_count,
         ld.latest_source_status
       FROM institution_sources ct
       LEFT JOIN catalog_counts cc ON cc.institution_id = ct.id
       LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
       LEFT JOIN raw_unverified_counts ruc ON ruc.institution_id = ct.id
       LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
       ${where}
     ) per_institution
     GROUP BY per_institution.state_code
     ORDER BY per_institution.state_code ASC`,
    queryParams,
  );

  return rows.map((row) => ({
    state_code: row.state_code,
    institution_count: Number(row.institution_count ?? 0),
    verified_institution_count: Number(row.verified_institution_count ?? 0),
    provisional_institution_count: Number(row.provisional_institution_count ?? 0),
    under_review_institution_count: Number(row.under_review_institution_count ?? 0),
    source_needed_institution_count: Number(row.source_needed_institution_count ?? 0),
    verified_fee_count: Number(row.verified_fee_count ?? 0),
    provisional_fee_count: Number(row.provisional_fee_count ?? 0),
  }));
}
