/**
 * Institution detail page queries.
 *
 * All functions use `sql` from connection.ts, wrap numeric returns with Number(),
 * and provide try/catch with safe fallbacks.
 */

import { sql } from "@/lib/data-store/connection";
import { toDateStr, safeJsonb } from "@/lib/pg-helpers";
import {
  classifyInstitutionQuality,
  getPublicInstitutionQualityLabel,
  type AgentFailureClass,
  type InstitutionQualitySignal,
  type InstitutionQualityStatus,
} from "@/lib/institution-quality";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Institution {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  fed_district: number | null;
  source: string | null;
  cert_number: string | null;
  rssd_id: string | null;
  lei: string | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  document_type: string | null;
  last_crawl_at: string;
  consecutive_failures: number;
  published_fee_count: number;
  latest_source_status: string | null;
  latest_extracted_fee_count: number;
  latest_source_collected_at: string | null;
  last_agent_failure_class: AgentFailureClass;
  quality_status: InstitutionQualityStatus;
  quality_signals: InstitutionQualitySignal[];
  quality_label: string;
}

export interface InstitutionFee {
  id: number;
  fee_name: string;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  extraction_confidence: number | null;
  review_status: string;
  fee_category: string | null;
  fee_family: string | null;
  account_product_type: string | null;
  is_fee_cap: boolean;
  source_url: string | null;
  variant_type: string | null;
  coverage_tier: string | null;
  created_at: string;
}

export interface InstitutionCrawl {
  id: number;
  source_collection_run_id: number | null;
  status: string;
  document_url: string | null;
  fees_extracted: number;
  error_message: string | null;
  crawled_at: string;
  /** Short content fingerprint: the same value means the same document version. */
  content_hash: string | null;
  /** True when our copy is in the document vault ("View our copy"). */
  stored: boolean;
  content_type: string | null;
  /** What Rosetta made of it: completed, wrong_document, needs_ocr, ... (null = not read). */
  read_status: string | null;
  read_note: string | null;
  /** Fees Knox pulled from this version. */
  knox_fees: number;
  last_checked_at: string | null;
}

export interface InstitutionAgentResult {
  id: number;
  agent_run_id: number;
  stage: string;
  status: string;
  detail: Record<string, unknown> | null;
  run_started_at: string;
  run_status: string;
}

export interface InstitutionSourceDocument {
  id: number;
  source_collection_run_id: number | null;
  status: string;
  document_url: string | null;
  document_path: string | null;
  content_hash: string | null;
  fees_extracted: number;
  error_message: string | null;
  crawled_at: string;
  status_code: number | null;
}

export interface InstitutionSourceText {
  id: number;
  agent_run_id: number | null;
  source_document_id: number;
  source_url: string | null;
  document_type: string | null;
  content_type: string | null;
  source_hash: string | null;
  status: string;
  char_count: number;
  error_message: string | null;
  updated_at: string;
  text_excerpt: string | null;
}

export interface InstitutionFeePipelineCounts {
  raw_fee_count: number;
  verified_fee_count: number;
  published_fee_count: number;
  raw_without_verified_count: number;
  verified_without_published_count: number;
}

export interface InstitutionRawFeePreview {
  fee_raw_id: number;
  source_document_id: number | null;
  fee_name: string;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  extraction_confidence: number | null;
  source_url: string | null;
  source: string;
  created_at: string;
}

export interface InstitutionVerifiedFeePreview {
  fee_verified_id: number;
  fee_raw_id: number;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | null;
  frequency: string | null;
  review_status: string;
  extraction_confidence: number | null;
  source_url: string | null;
  created_at: string;
}

export interface InstitutionFeeScheduleEvidence {
  latest_document: InstitutionSourceDocument | null;
  latest_text: InstitutionSourceText | null;
  pipeline_counts: InstitutionFeePipelineCounts;
  raw_fee_preview: InstitutionRawFeePreview[];
  verified_fee_preview: InstitutionVerifiedFeePreview[];
}

export type InstitutionSubmissionStatus =
  | "none"
  | "pending"
  | "accepted"
  | "needs_info"
  | "rejected";

export interface InstitutionSubmissionState {
  status: InstitutionSubmissionStatus;
  label: string;
  submission_count: number;
  pending_count: number;
  accepted_count: number;
  rejected_count: number;
  needs_info_count: number;
  latest_submission: {
    id: number;
    source_url: string;
    review_status: string;
    submission_kind: string;
    created_at: string;
    reviewed_at: string | null;
  } | null;
}

const INSTITUTION_EVIDENCE_CACHE_TTL_MS = 60_000;
const institutionEvidenceCache = new Map<number, {
  expiresAt: number;
  value: InstitutionFeeScheduleEvidence;
}>();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getInstitution(
  id: number,
): Promise<Institution | null> {
  try {
    const rows = await sql`
      WITH fee_counts AS (
        SELECT institution_id, COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count
        FROM published_fee_catalog
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
        ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
      )
      SELECT
        ct.id, ct.institution_name, ct.city, ct.state_code,
        ct.charter_type, ct.asset_size_tier, ct.asset_size,
        ct.fed_district, ct.source, ct.cert_number, ct.rssd_id, ct.lei, ct.website_url,
        ct.fee_schedule_url, ct.document_type,
        ct.last_crawl_at, ct.consecutive_failures,
        COALESCE(fc.published_fee_count, 0) as published_fee_count,
        ld.latest_source_status,
        COALESCE(ld.latest_extracted_fee_count, 0) as latest_extracted_fee_count,
        ld.latest_source_error,
        ld.latest_source_collected_at,
        CASE
          WHEN ld.latest_source_error ILIKE '%credit balance is too low%' THEN 'provider_credit'
          WHEN ld.latest_source_error ILIKE '%tool_use%' THEN 'tool_protocol'
          WHEN ld.latest_source_error ILIKE '%timeout%' OR ld.latest_source_error ILIKE '%timed out%' THEN 'timeout'
          WHEN ld.latest_source_error IS NULL OR btrim(ld.latest_source_error) = '' THEN 'none'
          ELSE 'other'
        END as last_agent_failure_class
      FROM institution_sources ct
      LEFT JOIN fee_counts fc ON fc.institution_id = ct.id
      LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
      WHERE ct.id = ${id}
    `;
    const r = rows[0];
    if (!r) return null;
    const latestSourceCollectedAt = r.latest_source_collected_at
      ? toDateStr(r.latest_source_collected_at as string | Date)
      : null;
    const publishedFeeCount = Number(r.published_fee_count ?? 0);
    const lastAgentFailureClass = String(r.last_agent_failure_class ?? "none") as AgentFailureClass;
    const quality = classifyInstitutionQuality({
      source: r.source ? String(r.source) : null,
      certNumber: r.cert_number ? String(r.cert_number) : null,
      rssdId: r.rssd_id ? String(r.rssd_id) : null,
      lei: r.lei ? String(r.lei) : null,
      websiteUrl: r.website_url ? String(r.website_url) : null,
      feeScheduleUrl: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
      publishedFeeCount,
      latestSourceStatus: r.latest_source_status ? String(r.latest_source_status) : null,
      latestExtractedFeeCount: Number(r.latest_extracted_fee_count ?? 0),
      latestSourceError: r.latest_source_error ? String(r.latest_source_error) : null,
      latestSourceCollectedAt,
      lastAgentFailureClass,
    });
    return {
      id: Number(r.id),
      institution_name: String(r.institution_name),
      city: r.city ? String(r.city) : null,
      state_code: r.state_code ? String(r.state_code) : null,
      charter_type: r.charter_type ? String(r.charter_type) : null,
      asset_size_tier: r.asset_size_tier ? String(r.asset_size_tier) : null,
      asset_size: r.asset_size != null ? Number(r.asset_size) : null,
      fed_district: r.fed_district != null ? Number(r.fed_district) : null,
      source: r.source ? String(r.source) : null,
      cert_number: r.cert_number ? String(r.cert_number) : null,
      rssd_id: r.rssd_id ? String(r.rssd_id) : null,
      lei: r.lei ? String(r.lei) : null,
      website_url: r.website_url ? String(r.website_url) : null,
      fee_schedule_url: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
      document_type: r.document_type ? String(r.document_type) : null,
      last_crawl_at: toDateStr(r.last_crawl_at as string | Date | null),
      consecutive_failures: Number(r.consecutive_failures ?? 0),
      published_fee_count: publishedFeeCount,
      latest_source_status: r.latest_source_status ? String(r.latest_source_status) : null,
      latest_extracted_fee_count: Number(r.latest_extracted_fee_count ?? 0),
      latest_source_collected_at: latestSourceCollectedAt,
      last_agent_failure_class: lastAgentFailureClass,
      quality_status: quality.quality_status,
      quality_signals: quality.quality_signals,
      quality_label: getPublicInstitutionQualityLabel(quality.quality_signals),
    };
  } catch (e) {
    console.error("getInstitution failed:", e);
    return null;
  }
}

export async function getInstitutionFees(
  id: number,
): Promise<InstitutionFee[]> {
  try {
    const rows = await sql`
      SELECT
        id, fee_name, amount, frequency, conditions,
        extraction_confidence, review_status,
        fee_category, fee_family,
        account_product_type, is_fee_cap,
        source_url, variant_type, coverage_tier,
        created_at
      FROM published_fee_catalog
      WHERE institution_id = ${id}
        AND review_status != 'rejected'
      ORDER BY fee_category ASC NULLS LAST, fee_name ASC
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      fee_name: String(r.fee_name),
      amount: r.amount != null ? Number(r.amount) : null,
      frequency: r.frequency ? String(r.frequency) : null,
      conditions: r.conditions ? String(r.conditions) : null,
      extraction_confidence: r.extraction_confidence != null
        ? Number(r.extraction_confidence)
        : null,
      review_status: String(r.review_status ?? "pending"),
      fee_category: r.fee_category ? String(r.fee_category) : null,
      fee_family: r.fee_family ? String(r.fee_family) : null,
      account_product_type: r.account_product_type
        ? String(r.account_product_type)
        : null,
      is_fee_cap: Boolean(r.is_fee_cap),
      source_url: r.source_url ? String(r.source_url) : null,
      variant_type: r.variant_type ? String(r.variant_type) : null,
      coverage_tier: r.coverage_tier ? String(r.coverage_tier) : null,
      created_at: toDateStr(r.created_at as string | Date | null),
    }));
  } catch (e) {
    console.error("getInstitutionFees failed:", e);
    return [];
  }
}

export async function getInstitutionFeeScheduleEvidence(
  id: number,
): Promise<InstitutionFeeScheduleEvidence> {
  const empty: InstitutionFeeScheduleEvidence = {
    latest_document: null,
    latest_text: null,
    pipeline_counts: {
      raw_fee_count: 0,
      verified_fee_count: 0,
      published_fee_count: 0,
      raw_without_verified_count: 0,
      verified_without_published_count: 0,
    },
    raw_fee_preview: [],
    verified_fee_preview: [],
  };
  const cached = institutionEvidenceCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const query = sql<Array<{
      latest_document: unknown;
      latest_text: unknown;
      pipeline_counts: unknown;
      raw_fee_preview: unknown;
      verified_fee_preview: unknown;
    }>>`
      WITH latest_document AS (
        SELECT
          id,
          source_collection_run_id,
          status,
          document_url,
          document_path,
          content_hash,
          COALESCE(fees_extracted, 0) AS fees_extracted,
          error_message,
          crawled_at,
          status_code
        FROM source_documents
        WHERE institution_id = ${id}
        ORDER BY crawled_at DESC NULLS LAST, id DESC
        LIMIT 1
      ),
      latest_text AS (
        SELECT
          id,
          agent_run_id,
          source_document_id,
          source_url,
          document_type,
          content_type,
          source_hash,
          status,
          COALESCE(char_count, 0) AS char_count,
          error_message,
          updated_at,
          NULLIF(left(COALESCE(normalized_text, ''), 700), '') AS text_excerpt
        FROM agent_source_texts
        WHERE institution_id = ${id}
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
      ),
      pipeline_counts AS (
        SELECT
          (
            SELECT COUNT(*)::int
            FROM raw_fee_observations fr
            WHERE fr.institution_id = ${id}
          ) AS raw_fee_count,
          (
            SELECT COUNT(*)::int
            FROM verified_fee_observations fv
            WHERE fv.institution_id = ${id}
              AND fv.review_status <> 'rejected'
          ) AS verified_fee_count,
          (
            SELECT COUNT(*)::int
            FROM published_fee_catalog pfc
            WHERE pfc.institution_id = ${id}
              AND pfc.review_status = 'approved'
          ) AS published_fee_count,
          (
            SELECT COUNT(*)::int
            FROM raw_fee_observations fr
            WHERE fr.institution_id = ${id}
              AND NOT EXISTS (
                SELECT 1
                FROM verified_fee_observations fv
                WHERE fv.fee_raw_id = fr.fee_raw_id
                  AND fv.review_status <> 'rejected'
              )
          ) AS raw_without_verified_count,
          (
            SELECT COUNT(*)::int
            FROM verified_fee_observations fv
            WHERE fv.institution_id = ${id}
              AND fv.review_status <> 'rejected'
              AND NOT EXISTS (
                SELECT 1
                FROM published_fee_catalog pfc
                WHERE pfc.fee_verified_id = fv.fee_verified_id
                  AND pfc.review_status <> 'rejected'
              )
          ) AS verified_without_published_count
      ),
      raw_fee_preview AS (
        SELECT
          fee_raw_id,
          source_document_id,
          fee_name,
          amount,
          frequency,
          conditions,
          extraction_confidence,
          source_url,
          source,
          created_at
        FROM raw_fee_observations
        WHERE institution_id = ${id}
        ORDER BY created_at DESC NULLS LAST, fee_raw_id DESC
        LIMIT 12
      ),
      verified_fee_preview AS (
        SELECT
          fee_verified_id,
          fee_raw_id,
          canonical_fee_key,
          fee_name,
          amount,
          frequency,
          review_status,
          extraction_confidence,
          source_url,
          created_at
        FROM verified_fee_observations
        WHERE institution_id = ${id}
        ORDER BY created_at DESC NULLS LAST, fee_verified_id DESC
        LIMIT 12
      )
      SELECT
        (SELECT row_to_json(latest_document) FROM latest_document) AS latest_document,
        (SELECT row_to_json(latest_text) FROM latest_text) AS latest_text,
        (SELECT row_to_json(pipeline_counts) FROM pipeline_counts) AS pipeline_counts,
        COALESCE(
          (SELECT json_agg(row_to_json(raw_fee_preview) ORDER BY created_at DESC NULLS LAST, fee_raw_id DESC) FROM raw_fee_preview),
          '[]'::json
        ) AS raw_fee_preview,
        COALESCE(
          (SELECT json_agg(row_to_json(verified_fee_preview) ORDER BY created_at DESC NULLS LAST, fee_verified_id DESC) FROM verified_fee_preview),
          '[]'::json
        ) AS verified_fee_preview
    `;
    const [row]: Array<{
      latest_document: unknown;
      latest_text: unknown;
      pipeline_counts: unknown;
      raw_fee_preview: unknown;
      verified_fee_preview: unknown;
    }> = await query;

    const documentRow = safeJsonb<Record<string, unknown>>(row?.latest_document) ?? null;
    const textRow = safeJsonb<Record<string, unknown>>(row?.latest_text) ?? null;
    const countRow = safeJsonb<Record<string, unknown>>(row?.pipeline_counts) ?? {};
    const rawRows = safeJsonb<Record<string, unknown>[]>(row?.raw_fee_preview) ?? [];
    const verifiedRows = safeJsonb<Record<string, unknown>[]>(row?.verified_fee_preview) ?? [];

    const evidence = {
      latest_document: documentRow
        ? {
            id: Number(documentRow.id),
            source_collection_run_id: documentRow.source_collection_run_id != null
              ? Number(documentRow.source_collection_run_id)
              : null,
            status: String(documentRow.status),
            document_url: documentRow.document_url ? String(documentRow.document_url) : null,
            document_path: documentRow.document_path ? String(documentRow.document_path) : null,
            content_hash: documentRow.content_hash ? String(documentRow.content_hash) : null,
            fees_extracted: Number(documentRow.fees_extracted ?? 0),
            error_message: documentRow.error_message ? String(documentRow.error_message) : null,
            crawled_at: toDateStr(documentRow.crawled_at as string | Date | null),
            status_code: documentRow.status_code != null ? Number(documentRow.status_code) : null,
          }
        : null,
      latest_text: textRow
        ? {
            id: Number(textRow.id),
            agent_run_id: textRow.agent_run_id != null ? Number(textRow.agent_run_id) : null,
            source_document_id: Number(textRow.source_document_id),
            source_url: textRow.source_url ? String(textRow.source_url) : null,
            document_type: textRow.document_type ? String(textRow.document_type) : null,
            content_type: textRow.content_type ? String(textRow.content_type) : null,
            source_hash: textRow.source_hash ? String(textRow.source_hash) : null,
            status: String(textRow.status),
            char_count: Number(textRow.char_count ?? 0),
            error_message: textRow.error_message ? String(textRow.error_message) : null,
            updated_at: toDateStr(textRow.updated_at as string | Date | null),
            text_excerpt: textRow.text_excerpt ? String(textRow.text_excerpt) : null,
          }
        : null,
      pipeline_counts: {
        raw_fee_count: Number(countRow?.raw_fee_count ?? 0),
        verified_fee_count: Number(countRow?.verified_fee_count ?? 0),
        published_fee_count: Number(countRow?.published_fee_count ?? 0),
        raw_without_verified_count: Number(countRow?.raw_without_verified_count ?? 0),
        verified_without_published_count: Number(countRow?.verified_without_published_count ?? 0),
      },
      raw_fee_preview: rawRows.map((r) => ({
        fee_raw_id: Number(r.fee_raw_id),
        source_document_id: r.source_document_id != null ? Number(r.source_document_id) : null,
        fee_name: String(r.fee_name),
        amount: r.amount != null ? Number(r.amount) : null,
        frequency: r.frequency ? String(r.frequency) : null,
        conditions: r.conditions ? String(r.conditions) : null,
        extraction_confidence: r.extraction_confidence != null
          ? Number(r.extraction_confidence)
          : null,
        source_url: r.source_url ? String(r.source_url) : null,
        source: String(r.source ?? "unknown"),
        created_at: toDateStr(r.created_at as string | Date | null),
      })),
      verified_fee_preview: verifiedRows.map((r) => ({
        fee_verified_id: Number(r.fee_verified_id),
        fee_raw_id: Number(r.fee_raw_id),
        canonical_fee_key: String(r.canonical_fee_key),
        fee_name: String(r.fee_name),
        amount: r.amount != null ? Number(r.amount) : null,
        frequency: r.frequency ? String(r.frequency) : null,
        review_status: String(r.review_status),
        extraction_confidence: r.extraction_confidence != null
          ? Number(r.extraction_confidence)
          : null,
        source_url: r.source_url ? String(r.source_url) : null,
        created_at: toDateStr(r.created_at as string | Date | null),
      })),
    };
    institutionEvidenceCache.set(id, {
      value: evidence,
      expiresAt: Date.now() + INSTITUTION_EVIDENCE_CACHE_TTL_MS,
    });
    return evidence;
  } catch (e) {
    console.error("getInstitutionFeeScheduleEvidence failed:", e);
    return empty;
  }
}

export async function getInstitutionSubmissionState(
  id: number,
): Promise<InstitutionSubmissionState> {
  const empty: InstitutionSubmissionState = {
    status: "none",
    label: "No source submission recorded.",
    submission_count: 0,
    pending_count: 0,
    accepted_count: 0,
    rejected_count: 0,
    needs_info_count: 0,
    latest_submission: null,
  };

  try {
    const [summaryRows, latestRows] = await Promise.all([
      sql<Record<string, unknown>[]>`
        SELECT
          COUNT(*)::int AS submission_count,
          COUNT(*) FILTER (WHERE review_status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE review_status = 'accepted')::int AS accepted_count,
          COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS rejected_count,
          COUNT(*) FILTER (WHERE review_status = 'needs_info')::int AS needs_info_count
        FROM community_fee_submissions
        WHERE institution_id = ${id}
      `,
      sql<Record<string, unknown>[]>`
        SELECT id, source_url, review_status, submission_kind, created_at, reviewed_at
        FROM community_fee_submissions
        WHERE institution_id = ${id}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
    ]);

    const summary = summaryRows[0] ?? {};
    const pendingCount = Number(summary.pending_count ?? 0);
    const acceptedCount = Number(summary.accepted_count ?? 0);
    const needsInfoCount = Number(summary.needs_info_count ?? 0);
    const rejectedCount = Number(summary.rejected_count ?? 0);
    const submissionCount = Number(summary.submission_count ?? 0);

    const status: InstitutionSubmissionStatus =
      pendingCount > 0
        ? "pending"
        : acceptedCount > 0
          ? "accepted"
          : needsInfoCount > 0
            ? "needs_info"
            : rejectedCount > 0
              ? "rejected"
              : "none";
    const label =
      status === "pending"
        ? "Source submitted, pending review."
        : status === "accepted"
          ? "Source accepted, awaiting validation."
          : status === "needs_info"
            ? "More source detail requested."
            : status === "rejected"
              ? "Submitted source was not usable."
              : "No source submission recorded.";
    const latest = latestRows[0] ?? null;

    return {
      status,
      label,
      submission_count: submissionCount,
      pending_count: pendingCount,
      accepted_count: acceptedCount,
      rejected_count: rejectedCount,
      needs_info_count: needsInfoCount,
      latest_submission: latest
        ? {
            id: Number(latest.id),
            source_url: String(latest.source_url),
            review_status: String(latest.review_status ?? "pending"),
            submission_kind: String(latest.submission_kind ?? "fee_row"),
            created_at: toDateStr(latest.created_at as string | Date | null),
            reviewed_at: latest.reviewed_at
              ? toDateStr(latest.reviewed_at as string | Date)
              : null,
          }
        : null,
    };
  } catch (e) {
    console.error("getInstitutionSubmissionState failed:", e);
    return empty;
  }
}

export async function getInstitutionCrawlHistory(
  id: number,
  limit = 25,
): Promise<InstitutionCrawl[]> {
  try {
    const rows = await sql`
      SELECT
        sd.id, sd.source_collection_run_id, sd.status, sd.document_url,
        COALESCE(sd.fees_extracted, 0) AS fees_extracted,
        sd.error_message, sd.crawled_at, sd.content_hash,
        sd.document_r2_key, sd.content_type, sd.last_checked_at,
        adt.status AS read_status, adt.error_message AS read_note,
        (SELECT COUNT(*)::int FROM raw_fee_observations fr
          WHERE fr.source = 'knox' AND fr.source_document_id = sd.id) AS knox_fees
      FROM source_documents sd
      LEFT JOIN agent_source_texts adt ON adt.source_document_id = sd.id
      WHERE sd.institution_id = ${id}
      ORDER BY sd.crawled_at DESC NULLS LAST, sd.id DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      source_collection_run_id: r.source_collection_run_id != null
        ? Number(r.source_collection_run_id)
        : null,
      status: String(r.status),
      document_url: r.document_url ? String(r.document_url) : null,
      fees_extracted: Number(r.fees_extracted),
      error_message: r.error_message ? String(r.error_message) : null,
      crawled_at: toDateStr(r.crawled_at as string | Date | null),
      content_hash: r.content_hash ? String(r.content_hash) : null,
      stored: typeof r.document_r2_key === "string" && /^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(r.document_r2_key),
      content_type: r.content_type ? String(r.content_type) : null,
      read_status: r.read_status ? String(r.read_status) : null,
      read_note: r.read_note ? String(r.read_note) : null,
      knox_fees: Number(r.knox_fees ?? 0),
      last_checked_at: r.last_checked_at ? toDateStr(r.last_checked_at as string | Date) : null,
    }));
  } catch (e) {
    // Before the document-vault migration the new columns don't exist; show the basics.
    console.error("getInstitutionCrawlHistory (source history) failed, falling back:", e);
    return getBasicCrawlHistory(id, limit);
  }
}

async function getBasicCrawlHistory(id: number, limit: number): Promise<InstitutionCrawl[]> {
  try {
    const rows = await sql`
      SELECT
        id, source_collection_run_id, status, document_url,
        COALESCE(fees_extracted, 0) as fees_extracted,
        error_message, crawled_at, content_hash
      FROM source_documents
      WHERE institution_id = ${id}
      ORDER BY crawled_at DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      source_collection_run_id: r.source_collection_run_id != null
        ? Number(r.source_collection_run_id)
        : null,
      status: String(r.status),
      document_url: r.document_url ? String(r.document_url) : null,
      fees_extracted: Number(r.fees_extracted),
      error_message: r.error_message ? String(r.error_message) : null,
      crawled_at: toDateStr(r.crawled_at as string | Date | null),
      content_hash: r.content_hash ? String(r.content_hash) : null,
      stored: false,
      content_type: null,
      read_status: null,
      read_note: null,
      knox_fees: 0,
      last_checked_at: null,
    }));
  } catch (e) {
    console.error("getInstitutionCrawlHistory failed:", e);
    return [];
  }
}

export async function getInstitutionAgentResults(
  id: number,
  limit = 10,
): Promise<InstitutionAgentResult[]> {
  try {
    const rows = await sql`
      SELECT
        arr.id,
        arr.agent_run_id,
        arr.stage,
        arr.status,
        arr.detail,
        ar.started_at as run_started_at,
        ar.status as run_status
      FROM agent_institution_run_results arr
      JOIN agent_runs ar ON ar.id = arr.agent_run_id
      WHERE arr.institution_id = ${id}
      ORDER BY ar.started_at DESC NULLS LAST, arr.id DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      agent_run_id: Number(r.agent_run_id),
      stage: String(r.stage),
      status: String(r.status),
      detail: safeJsonb<Record<string, unknown>>(r.detail),
      run_started_at: toDateStr(r.run_started_at as string | Date | null),
      run_status: String(r.run_status),
    }));
  } catch (e) {
    console.error("getInstitutionAgentResults failed:", e);
    return [];
  }
}
