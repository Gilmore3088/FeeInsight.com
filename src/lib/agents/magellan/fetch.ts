import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { CRAWLER_USER_AGENT } from "@/lib/agents/crawler-identity";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const MAGELLAN_FETCH_DEFAULT_LIMIT = 25;
export const MAGELLAN_FETCH_MAX_LIMIT = 50;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

interface FetchCandidateRow {
  id: number | string;
  institution_name: string;
  fee_schedule_url: string | null;
  asset_size: number | string | null;
  last_crawl_at: string | Date | null;
  consecutive_failures: number | string | null;
  profile_canonical_source_url?: string | null;
}

type FetchOutcome = "success" | "failed" | "skipped";

interface FetchResult {
  institutionId: number;
  institutionName: string;
  outcome: FetchOutcome;
  sourceUrl: string | null;
  finalUrl: string | null;
  statusCode: number | null;
  contentType: string | null;
  documentType: string | null;
  contentHash: string | null;
  bytes: number;
  reason: string | null;
}

export interface RunMagellanFetchOptions {
  runId: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  dryRun?: boolean;
  db?: SqlTag;
  fetchImpl?: Fetcher;
}

export interface RunMagellanFetchResult {
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  bytes: number;
  limit: number;
  dryRun: boolean;
  results: FetchResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAGELLAN_FETCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAGELLAN_FETCH_MAX_LIMIT);
}

function normalizeHttpUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function detectDocumentType(url: string, contentType: string | null): string {
  const lowerType = contentType?.toLowerCase() ?? "";
  const lowerUrl = url.toLowerCase();
  if (lowerType.includes("application/pdf") || lowerUrl.endsWith(".pdf")) return "pdf";
  if (lowerType.includes("text/html")) return "html";
  if (lowerType.includes("text/plain")) return "text";
  return "unknown";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchWithTimeout(fetchImpl: Fetcher, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/html,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCandidate(
  row: FetchCandidateRow,
  fetchImpl: Fetcher,
): Promise<FetchResult> {
  const institutionId = Number(row.id);
  const institutionName = String(row.institution_name);
  const sourceUrl = normalizeHttpUrl(row.profile_canonical_source_url ?? row.fee_schedule_url);
  if (!sourceUrl) {
    return {
      institutionId,
      institutionName,
      outcome: "skipped",
      sourceUrl: row.fee_schedule_url,
      finalUrl: null,
      statusCode: null,
      contentType: null,
      documentType: null,
      contentHash: null,
      bytes: 0,
      reason: "Invalid or missing fee_schedule_url",
    };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, sourceUrl);
  } catch (error) {
    return {
      institutionId,
      institutionName,
      outcome: "failed",
      sourceUrl,
      finalUrl: null,
      statusCode: null,
      contentType: null,
      documentType: null,
      contentHash: null,
      bytes: 0,
      reason: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const finalUrl = response.url || sourceUrl;
  const contentType = response.headers.get("content-type");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOCUMENT_BYTES) {
    return {
      institutionId,
      institutionName,
      outcome: "failed",
      sourceUrl,
      finalUrl,
      statusCode: response.status,
      contentType,
      documentType: detectDocumentType(finalUrl, contentType),
      contentHash: null,
      bytes: 0,
      reason: `Document too large: ${contentLength} bytes`,
    };
  }

  if (!response.ok) {
    return {
      institutionId,
      institutionName,
      outcome: "failed",
      sourceUrl,
      finalUrl,
      statusCode: response.status,
      contentType,
      documentType: detectDocumentType(finalUrl, contentType),
      contentHash: null,
      bytes: 0,
      reason: `HTTP ${response.status}`,
    };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    return {
      institutionId,
      institutionName,
      outcome: "failed",
      sourceUrl,
      finalUrl,
      statusCode: response.status,
      contentType,
      documentType: detectDocumentType(finalUrl, contentType),
      contentHash: null,
      bytes: buffer.byteLength,
      reason: `Document too large: ${buffer.byteLength} bytes`,
    };
  }

  const bytes = new Uint8Array(buffer);
  return {
    institutionId,
    institutionName,
    outcome: "success",
    sourceUrl,
    finalUrl,
    statusCode: response.status,
    contentType,
    documentType: detectDocumentType(finalUrl, contentType),
    contentHash: sha256(bytes),
    bytes: bytes.byteLength,
    reason: null,
  };
}

async function selectCandidates(
  db: SqlTag,
  limit: number,
  institutionId?: number,
  stateCode?: string,
): Promise<FetchCandidateRow[]> {
  const normalizedState = normalizeStateCode(stateCode);
  if (institutionId) {
    return db<FetchCandidateRow[]>`
      SELECT inst.id,
             inst.institution_name,
             inst.fee_schedule_url,
             inst.asset_size,
             inst.last_crawl_at,
             inst.consecutive_failures,
             profile.canonical_source_url AS profile_canonical_source_url
        FROM institution_sources inst
        LEFT JOIN institution_source_profiles profile
          ON profile.institution_id = inst.id
       WHERE inst.id = ${institutionId}
         AND COALESCE(inst.status, 'active') = 'active'
         AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       LIMIT 1
    `;
  }

  return db<FetchCandidateRow[]>`
    SELECT inst.id,
           inst.institution_name,
           inst.fee_schedule_url,
           inst.asset_size,
           inst.last_crawl_at,
           inst.consecutive_failures,
           profile.canonical_source_url AS profile_canonical_source_url
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND (
         profile.canonical_source_url IS NOT NULL
         OR (inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> '')
       )
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND (
         inst.last_crawl_at IS NULL
         OR inst.last_crawl_at < NOW() - CASE
           WHEN COALESCE(inst.consecutive_failures, 0) >= 3 THEN INTERVAL '7 days'
           WHEN COALESCE(inst.consecutive_failures, 0) > 0 THEN INTERVAL '24 hours'
           ELSE INTERVAL '12 hours'
         END
       )
     ORDER BY
       CASE WHEN profile.locked_by_correction IS TRUE AND profile.canonical_source_url IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.last_crawl_at IS NULL THEN 0 ELSE 1 END,
       inst.last_crawl_at ASC NULLS FIRST,
       COALESCE(inst.consecutive_failures, 0) ASC,
       inst.asset_size DESC NULLS LAST,
       inst.id ASC
     LIMIT ${limit}
  `;
}

async function recordFetchResult(db: SqlTag, result: FetchResult): Promise<void> {
  const crawlStatus = result.outcome === "success" ? "success" : "failed";
  const [sourceDocument] = await db`
    INSERT INTO source_documents
      (institution_id, status, document_url, document_path, content_hash,
       fees_extracted, error_message, crawled_at, status_code)
    VALUES
      (${result.institutionId}, ${crawlStatus}, ${result.finalUrl ?? result.sourceUrl},
       NULL, ${result.contentHash}, 0, ${result.reason}, NOW(), ${result.statusCode})
    RETURNING id
  `;
  const sourceDocumentId = sourceDocument?.id == null ? null : Number(sourceDocument.id);

  if (result.outcome === "success") {
    await db`
      UPDATE institution_sources
         SET last_crawl_at = NOW(),
             last_success_at = NOW(),
             consecutive_failures = 0,
             last_content_hash = ${result.contentHash},
             document_type = ${result.documentType},
             document_type_detected = ${result.documentType},
             failure_reason = NULL,
             failure_reason_note = NULL,
             failure_reason_updated_at = failure_reason_updated_at
       WHERE id = ${result.institutionId}
    `;
    await db`
      INSERT INTO institution_source_profiles (
        institution_id,
        state_code,
        canonical_source_url,
        source_kind,
        read_strategy,
        last_source_hash,
        last_successful_source_document_id,
        last_success_at,
        last_failure_at,
        last_failure_reason,
        consecutive_failures,
        created_at,
        updated_at
      )
      SELECT
        inst.id,
        upper(btrim(inst.state_code)),
        ${result.finalUrl ?? result.sourceUrl},
        ${sourceKindFromDocumentType(result.documentType)},
        ${readStrategyFromDocumentType(result.documentType)},
        ${result.contentHash},
        ${sourceDocumentId},
        NOW(),
        NULL,
        NULL,
        0,
        NOW(),
        NOW()
      FROM institution_sources inst
      WHERE inst.id = ${result.institutionId}
      ON CONFLICT (institution_id) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        canonical_source_url = CASE
          WHEN institution_source_profiles.locked_by_correction
            THEN institution_source_profiles.canonical_source_url
          ELSE EXCLUDED.canonical_source_url
        END,
        source_kind = CASE
          WHEN institution_source_profiles.locked_by_correction
            THEN institution_source_profiles.source_kind
          ELSE EXCLUDED.source_kind
        END,
        read_strategy = CASE
          WHEN institution_source_profiles.locked_by_correction
            THEN institution_source_profiles.read_strategy
          ELSE EXCLUDED.read_strategy
        END,
        last_source_hash = EXCLUDED.last_source_hash,
        last_successful_source_document_id = EXCLUDED.last_successful_source_document_id,
        last_success_at = NOW(),
        last_failure_at = NULL,
        last_failure_reason = NULL,
        consecutive_failures = 0,
        updated_at = NOW()
    `;
    return;
  }

  await db`
    UPDATE institution_sources
       SET last_crawl_at = NOW(),
           consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
           failure_reason = 'agentic_fetch_failed',
           failure_reason_note = ${result.reason},
           failure_reason_updated_at = NOW()
     WHERE id = ${result.institutionId}
  `;
  await db`
    INSERT INTO institution_source_profiles (
      institution_id,
      state_code,
      canonical_source_url,
      source_kind,
      read_strategy,
      last_failure_at,
      last_failure_reason,
      consecutive_failures,
      created_at,
      updated_at
    )
    SELECT
      inst.id,
      upper(btrim(inst.state_code)),
      ${result.sourceUrl},
      ${sourceKindFromDocumentType(result.documentType)},
      ${readStrategyFromDocumentType(result.documentType)},
      NOW(),
      ${result.reason},
      1,
      NOW(),
      NOW()
    FROM institution_sources inst
    WHERE inst.id = ${result.institutionId}
    ON CONFLICT (institution_id) DO UPDATE SET
      state_code = EXCLUDED.state_code,
      canonical_source_url = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.canonical_source_url
        ELSE COALESCE(EXCLUDED.canonical_source_url, institution_source_profiles.canonical_source_url)
      END,
      source_kind = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.source_kind
        ELSE COALESCE(EXCLUDED.source_kind, institution_source_profiles.source_kind)
      END,
      read_strategy = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.read_strategy
        ELSE COALESCE(EXCLUDED.read_strategy, institution_source_profiles.read_strategy)
      END,
      last_failure_at = NOW(),
      last_failure_reason = EXCLUDED.last_failure_reason,
      consecutive_failures = institution_source_profiles.consecutive_failures + 1,
      updated_at = NOW()
  `;
}

export async function runMagellanFetch(
  options: RunMagellanFetchOptions,
): Promise<RunMagellanFetchResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const rows = await selectCandidates(db, limit, options.institutionId, options.stateCode);

  const results: FetchResult[] = [];
  for (const row of rows) {
    const result = await fetchCandidate(row, fetchImpl);
    results.push(result);
    if (!dryRun) await recordFetchResult(db, result);
  }

  return {
    selected: rows.length,
    processed: results.length,
    succeeded: results.filter((result) => result.outcome === "success").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    bytes: results.reduce((total, result) => total + result.bytes, 0),
    limit,
    dryRun,
    results,
  };
}
