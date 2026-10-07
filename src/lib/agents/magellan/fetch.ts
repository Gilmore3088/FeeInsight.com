import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { inSavepoint } from "@/lib/agents/savepoint";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import {
  documentVaultSchemaReady,
  getDocumentVault,
  type DocumentVault,
  type VaultStoreStatus,
} from "@/lib/agents/document-vault";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { markCurrentCopy, supersedeSamePageCopies, type SamePageCopyResult } from "@/lib/agents/magellan/current-copy";
import { detectFormat, documentTypeForFormat } from "@/lib/agents/learning/format";
import { classifyFetchFailure, countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { runCompanionFetch, type RunCompanionFetchResult } from "./companion-fetch";
import { addOperatorSchedules, type OperatorScheduleResult } from "./operator-schedules";
import { isErrorPageLink } from "./link-coverage";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const MAGELLAN_FETCH_DEFAULT_LIMIT = 25;
export const MAGELLAN_FETCH_MAX_LIMIT = 50;
/**
 * An hourly backlog run also re-fetches a fee link last fetched this many days ago, so a
 * state's schedules stay current between full passes (Texas had 189 live links unfetched
 * since April on 2026-10-06, failing its state report's 90-day freshness check). Fetching
 * is free; changed text is read and extracted on the state's normal cadence.
 */
export const MAGELLAN_STALE_LINK_REFETCH_DAYS = 30;

/** The fetch strategy recorded in the attempt log; bump the version when its behavior changes. */
export const MAGELLAN_FETCH_STRATEGY = { strategy: "fetch.http", version: 2 } as const;

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
  profile_last_source_hash?: string | null;
  profile_last_document_id?: number | string | null;
}

/** The last stored copy of an institution's fee document, for conditional requests. */
interface PreviousDocument {
  id: number | null;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  /** Our stored copy, when the vault already has it. */
  vaultKey: string | null;
}

type FetchOutcome = "success" | "unchanged" | "failed" | "skipped";

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
  /** Typed outcome for the attempt log; null when no request was made. */
  attemptOutcome: AttemptOutcome | null;
  etag: string | null;
  lastModified: string | null;
  durationMs: number;
  /** The existing document this fetch matched, when unchanged. */
  previousDocumentId: number | null;
  /** True when new-looking content matched an older stored document of this institution. */
  reusedDocument?: boolean;
  /** True when the link's redirects ended on the site's homepage. */
  redirectedHome?: boolean;
  /** True when the gone link was cleared and the bank sent back to discovery. */
  sentBackToDiscovery?: boolean;
  /** Downloaded bytes, kept only long enough to store them in the vault. */
  body: Uint8Array | null;
  vaultStatus: VaultStoreStatus | null;
  vaultKey: string | null;
}

export interface RunMagellanFetchOptions {
  runId: number;
  stepId?: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  /**
   * Only banks whose fee link was found after their last fetch, or was last fetched over
   * MAGELLAN_STALE_LINK_REFETCH_DAYS ago (hourly backlog runs).
   */
  newLinksOnly?: boolean;
  dryRun?: boolean;
  db?: SqlTag;
  fetchImpl?: Fetcher;
  vault?: DocumentVault;
}

export interface RunMagellanFetchResult {
  selected: number;
  processed: number;
  succeeded: number;
  /** Fetched fine, but the content matched the stored copy: no new document. */
  unchanged: number;
  /** Of those, content that matched an older stored copy rather than the latest one. */
  reusedDocuments: number;
  failed: number;
  skipped: number;
  bytes: number;
  limit: number;
  dryRun: boolean;
  /** False until the learning-core migration is applied (no attempt log yet). */
  learning: boolean;
  /** Documents saved to the R2 vault this run (new files plus unchanged ones not yet stored). */
  storedDocuments: number;
  vault: "on" | "not_configured" | "schema_pending";
  outcomes: Partial<Record<AttemptOutcome, number>>;
  /** Older copies of fetched pages newly marked as history (superseded_by_id). */
  supersededCopies: number;
  /** Companion pages (account pages, other fee documents) fetched after the fee links. */
  companions: RunCompanionFetchResult | null;
  operatorSchedules: OperatorScheduleResult | null;
  /** Current copies superseded (or logged, in shadow mode) by a newer spelling of their page. */
  samePageCopies: SamePageCopyResult | null;
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

const HOMEPAGE_PATH = /^\/?(index\.(html?|php|aspx?))?$/i;

/**
 * A fee link with a path that lands on the site's homepage after redirects is gone: the
 * bank moved or removed the page and its server sends every old address home (or to a
 * new domain's home). 42 banks' fee links did this in the week to 2026-10-06.
 */
export function redirectedToHomepage(requestedUrl: string, finalUrl: string | null): boolean {
  if (!finalUrl) return false;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    const requestedIsHome = HOMEPAGE_PATH.test(requested.pathname) && !requested.search;
    const finalIsHome = HOMEPAGE_PATH.test(final.pathname) && !final.search;
    return !requestedIsHome && finalIsHome;
  } catch {
    return false;
  }
}

/**
 * Fetch outcomes that mean the link itself is gone, not that the site had a bad moment.
 * A link whose address is the site's error page is gone however the fetch went: Northern
 * Trust's ".../page-not-found" timed out on every fetch and kept the bank out of discovery.
 */
function linkIsGone(result: FetchResult): boolean {
  return (
    result.attemptOutcome === "http_404" ||
    result.attemptOutcome === "http_410" ||
    result.redirectedHome === true ||
    isErrorPageLink(result.sourceUrl)
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchWithTimeout(
  fetchImpl: Fetcher,
  url: string,
  previous: PreviousDocument | null,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "User-Agent": crawlerUserAgent("Magellan"),
    Accept: "text/html,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  };
  // Conditional GET: a 304 means the stored copy is current and costs no download.
  if (previous?.contentHash && previous.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.contentHash && previous.lastModified) headers["If-Modified-Since"] = previous.lastModified;
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCandidate(
  row: FetchCandidateRow,
  fetchImpl: Fetcher,
  previous: PreviousDocument | null,
): Promise<FetchResult> {
  const startedAt = Date.now();
  const institutionId = Number(row.id);
  const institutionName = String(row.institution_name);
  const sourceUrl = normalizeHttpUrl(row.profile_canonical_source_url ?? row.fee_schedule_url);
  const base = {
    institutionId,
    institutionName,
    sourceUrl,
    finalUrl: null as string | null,
    statusCode: null as number | null,
    contentType: null as string | null,
    documentType: null as string | null,
    contentHash: null as string | null,
    bytes: 0,
    etag: null as string | null,
    lastModified: null as string | null,
    previousDocumentId: null as number | null,
    body: null as Uint8Array | null,
    vaultStatus: null as VaultStoreStatus | null,
    vaultKey: null as string | null,
  };
  const finish = (fields: Partial<FetchResult> & Pick<FetchResult, "outcome" | "reason" | "attemptOutcome">): FetchResult => ({
    ...base,
    ...fields,
    durationMs: Date.now() - startedAt,
  });

  if (!sourceUrl) {
    return finish({
      outcome: "skipped",
      sourceUrl: row.fee_schedule_url,
      reason: "Invalid or missing fee_schedule_url",
      attemptOutcome: "invalid_url",
    });
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, sourceUrl, previous);
  } catch (error) {
    return finish({
      outcome: "failed",
      reason: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      attemptOutcome: classifyFetchFailure(null, error),
    });
  }

  const finalUrl = response.url || sourceUrl;
  const contentType = response.headers.get("content-type");
  const headerFields = {
    finalUrl,
    statusCode: response.status,
    contentType,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };

  if (response.status === 304 && previous?.contentHash) {
    return finish({
      ...headerFields,
      outcome: "unchanged",
      contentHash: previous.contentHash,
      previousDocumentId: previous.id,
      reason: null,
      attemptOutcome: "unchanged",
    });
  }

  const declaredType = documentTypeForFormat(detectFormat(null, contentType, finalUrl));
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOCUMENT_BYTES) {
    return finish({
      ...headerFields,
      outcome: "failed",
      documentType: declaredType,
      reason: `Document too large: ${contentLength} bytes`,
      attemptOutcome: "too_large",
    });
  }

  if (!response.ok) {
    return finish({
      ...headerFields,
      outcome: "failed",
      documentType: declaredType,
      reason: `HTTP ${response.status}`,
      attemptOutcome: classifyFetchFailure(response.status),
    });
  }

  if (redirectedToHomepage(sourceUrl, finalUrl)) {
    await response.body?.cancel().catch(() => undefined);
    return finish({
      ...headerFields,
      outcome: "failed",
      documentType: declaredType,
      reason: `Link redirects to the homepage (${finalUrl})`,
      attemptOutcome: "wrong_document",
      redirectedHome: true,
    });
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    return finish({
      ...headerFields,
      outcome: "failed",
      documentType: declaredType,
      reason: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      attemptOutcome: classifyFetchFailure(null, error),
    });
  }
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    return finish({
      ...headerFields,
      outcome: "failed",
      documentType: declaredType,
      bytes: buffer.byteLength,
      reason: `Document too large: ${buffer.byteLength} bytes`,
      attemptOutcome: "too_large",
    });
  }

  const bytes = new Uint8Array(buffer);
  const contentHash = sha256(bytes);
  const documentType = documentTypeForFormat(detectFormat(bytes, contentType, finalUrl));
  if (previous?.contentHash && previous.contentHash === contentHash) {
    return finish({
      ...headerFields,
      outcome: "unchanged",
      documentType,
      contentHash,
      bytes: bytes.byteLength,
      previousDocumentId: previous.id,
      body: bytes,
      reason: null,
      attemptOutcome: "unchanged",
    });
  }

  return finish({
    ...headerFields,
    outcome: "success",
    documentType,
    contentHash,
    bytes: bytes.byteLength,
    body: bytes,
    reason: null,
    attemptOutcome: "ok",
  });
}

async function selectCandidates(
  db: SqlTag,
  limit: number,
  institutionId?: number,
  stateCode?: string,
  newLinksOnly = false,
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
             profile.canonical_source_url AS profile_canonical_source_url,
             profile.last_source_hash AS profile_last_source_hash,
             profile.last_successful_source_document_id AS profile_last_document_id
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
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.last_source_hash AS profile_last_source_hash,
           profile.last_successful_source_document_id AS profile_last_document_id
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
       -- A link discovery found after the last fetch is fetched at once and first. An
       -- hourly backlog run fetches those and links last fetched over a month ago.
       AND (NOT ${newLinksOnly}::boolean OR (
         inst.rescue_status = 'rescued'
         AND inst.last_rescue_attempt_at > COALESCE(inst.last_crawl_at, '-infinity'::timestamptz)
       ) OR inst.last_crawl_at < NOW() - make_interval(days => ${MAGELLAN_STALE_LINK_REFETCH_DAYS}))
       AND (
         inst.last_crawl_at IS NULL
         OR (inst.rescue_status = 'rescued' AND inst.last_rescue_attempt_at > inst.last_crawl_at)
         OR inst.last_crawl_at < NOW() - CASE
           WHEN COALESCE(inst.consecutive_failures, 0) >= 3 THEN INTERVAL '7 days'
           WHEN COALESCE(inst.consecutive_failures, 0) > 0 THEN INTERVAL '24 hours'
           ELSE INTERVAL '12 hours'
         END
       )
     ORDER BY
       CASE WHEN profile.locked_by_correction IS TRUE AND profile.canonical_source_url IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.last_crawl_at IS NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.rescue_status = 'rescued' AND inst.last_rescue_attempt_at > inst.last_crawl_at THEN 0 ELSE 1 END,
       inst.last_crawl_at ASC NULLS FIRST,
       COALESCE(inst.consecutive_failures, 0) ASC,
       inst.asset_size DESC NULLS LAST,
       inst.id ASC
     LIMIT ${limit}
  `;
}

async function loadPreviousDocument(
  db: SqlTag,
  row: FetchCandidateRow,
  learning: boolean,
  vaultSchema: boolean,
): Promise<PreviousDocument | null> {
  const fromProfile: PreviousDocument | null = row.profile_last_source_hash
    ? {
        id: row.profile_last_document_id == null ? null : Number(row.profile_last_document_id),
        contentHash: row.profile_last_source_hash,
        etag: null,
        lastModified: null,
        vaultKey: null,
      }
    : null;
  if (!learning) return fromProfile;
  const [latest] = vaultSchema
    ? await db`
    SELECT id, content_hash, etag, last_modified, document_r2_key
      FROM source_documents
     WHERE institution_id = ${Number(row.id)}
       AND status = 'success'
       AND content_hash IS NOT NULL
     ORDER BY crawled_at DESC NULLS LAST, id DESC
     LIMIT 1
  `
    : await db`
    SELECT id, content_hash, etag, last_modified
      FROM source_documents
     WHERE institution_id = ${Number(row.id)}
       AND status = 'success'
       AND content_hash IS NOT NULL
     ORDER BY crawled_at DESC NULLS LAST, id DESC
     LIMIT 1
  `;
  if (!latest) return fromProfile;
  return {
    id: Number(latest.id),
    contentHash: String(latest.content_hash),
    etag: latest.etag == null ? null : String(latest.etag),
    lastModified: latest.last_modified == null ? null : String(latest.last_modified),
    vaultKey: latest.document_r2_key == null ? null : String(latest.document_r2_key),
  };
}

/** Same content as the stored copy: touch it instead of inserting a duplicate document. */
async function recordUnchanged(db: SqlTag, result: FetchResult, learning: boolean): Promise<void> {
  if (learning && result.previousDocumentId != null) {
    await db`
      UPDATE source_documents
         SET last_checked_at = NOW(),
             etag = COALESCE(${result.etag}, etag),
             last_modified = COALESCE(${result.lastModified}, last_modified)
       WHERE id = ${result.previousDocumentId}
    `;
  }
  await db`
    UPDATE institution_sources
       SET last_crawl_at = NOW(),
           last_success_at = NOW(),
           consecutive_failures = 0,
           failure_reason = NULL,
           failure_reason_note = NULL
     WHERE id = ${result.institutionId}
  `;
  await db`
    UPDATE institution_source_profiles
       SET last_success_at = NOW(),
           last_failure_at = NULL,
           last_failure_reason = NULL,
           consecutive_failures = 0,
           updated_at = NOW()
     WHERE institution_id = ${result.institutionId}
  `;
}

async function insertSourceDocument(db: SqlTag, result: FetchResult, learning: boolean): Promise<number | null> {
  const crawlStatus = result.outcome === "success" ? "success" : "failed";
  const [sourceDocument] = learning
    ? await db`
        INSERT INTO source_documents
          (institution_id, status, document_url, document_path, content_hash,
           fees_extracted, error_message, crawled_at, status_code,
           etag, last_modified, last_checked_at)
        VALUES
          (${result.institutionId}, ${crawlStatus}, ${result.finalUrl ?? result.sourceUrl},
           NULL, ${result.contentHash}, 0, ${result.reason}, NOW(), ${result.statusCode},
           ${result.etag}, ${result.lastModified}, NOW())
        RETURNING id
      `
    : await db`
        INSERT INTO source_documents
          (institution_id, status, document_url, document_path, content_hash,
           fees_extracted, error_message, crawled_at, status_code)
        VALUES
          (${result.institutionId}, ${crawlStatus}, ${result.finalUrl ?? result.sourceUrl},
           NULL, ${result.contentHash}, 0, ${result.reason}, NOW(), ${result.statusCode})
        RETURNING id
      `;
  return sourceDocument?.id == null ? null : Number(sourceDocument.id);
}

/**
 * The document that already holds these bytes for this institution, if any: the copy
 * Rosetta read first, else the oldest. Content that changes and later changes back
 * (A, B, A) reuses the first A instead of storing it again; the unique index on
 * (institution_id, content_hash) relies on this.
 */
async function findDocumentWithContent(db: SqlTag, institutionId: number, contentHash: string): Promise<number | null> {
  const [existing] = await db`
    SELECT doc.id
      FROM source_documents doc
     WHERE doc.institution_id = ${institutionId}
       AND doc.content_hash = ${contentHash}
       AND doc.status = 'success'
     ORDER BY EXISTS (
                SELECT 1 FROM agent_source_texts adt
                 WHERE adt.source_document_id = doc.id AND adt.status = 'completed'
              ) DESC,
              doc.id ASC
     LIMIT 1
  `;
  return existing?.id == null ? null : Number(existing.id);
}

/** Writes the fetch result; returns the source document it created or matched. */
async function recordFetchResult(db: SqlTag, result: FetchResult, learning: boolean): Promise<number | null> {
  if (result.outcome === "unchanged") {
    await recordUnchanged(db, result, learning);
    return result.previousDocumentId;
  }
  if (result.outcome === "success" && result.contentHash) {
    const existingId = await findDocumentWithContent(db, result.institutionId, result.contentHash);
    if (existingId != null) {
      await recordUnchanged(db, { ...result, previousDocumentId: existingId }, learning);
      await db`
        UPDATE institution_sources
           SET last_content_hash = ${result.contentHash},
               document_type = ${result.documentType},
               document_type_detected = ${result.documentType}
         WHERE id = ${result.institutionId}
      `;
      // No new document: report it as unchanged content, which it is for this bank.
      result.outcome = "unchanged";
      result.attemptOutcome = "unchanged";
      result.previousDocumentId = existingId;
      result.reusedDocument = true;
      return existingId;
    }
  }
  const sourceDocumentId = await insertSourceDocument(db, result, learning);

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
    return sourceDocumentId;
  }

  await db`
    UPDATE institution_sources
       SET last_crawl_at = NOW(),
           consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
           failure_reason = ${`magellan_fetch_${result.attemptOutcome ?? "failed"}`},
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
  return sourceDocumentId;
}

/**
 * A gone link (404/410, or redirected to the homepage) is never going to work again, so
 * the bank goes back to discovery the way Rosetta sends back a dead link it reads:
 * remember the URL as rejected, drop the fetch address, clear the fee link while it is
 * still the one fetched, and mark the bank due a search. Before this, the bank kept the
 * dead link and was re-fetched every week, and discovery (which only searches banks
 * with no link) never looked for its new page. A person's locked correction is kept.
 */
async function sendGoneLinkToDiscovery(db: SqlTag, result: FetchResult, feeScheduleUrl: string | null): Promise<boolean> {
  const rejected = JSON.stringify([{ url: result.sourceUrl, reason: result.reason, at: new Date().toISOString() }]);
  await db`
    UPDATE institution_source_profiles
       SET rejected_source_urls = (
             SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
               FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
              WHERE entry->>'url' IS DISTINCT FROM ${result.sourceUrl}
           ) || ${rejected}::jsonb,
           canonical_source_url = CASE WHEN locked_by_correction THEN canonical_source_url ELSE NULL END,
           updated_at = NOW()
     WHERE institution_id = ${result.institutionId}
  `;
  const cleared = await db`
    UPDATE institution_sources inst
       SET fee_schedule_url = NULL,
           rescue_status = 'pending',
           failure_reason = 'magellan_dead_link',
           failure_reason_note = ${result.reason},
           failure_reason_updated_at = NOW()
     WHERE inst.id = ${result.institutionId}
       AND btrim(COALESCE(inst.fee_schedule_url, '')) = ${feeScheduleUrl?.trim() ?? ""}
       AND NOT EXISTS (
         SELECT 1 FROM institution_source_profiles profile
          WHERE profile.institution_id = inst.id AND profile.locked_by_correction IS TRUE
       )
    RETURNING inst.id
  `;
  return cleared.length > 0;
}

/** Saves the downloaded bytes to the vault and records the key on the document row. */
async function storeInVault(
  db: SqlTag,
  vault: DocumentVault,
  result: FetchResult,
  sourceDocumentId: number | null,
): Promise<void> {
  if (!result.body || !result.contentHash || sourceDocumentId == null) return;
  const stored = await vault.store(result.body, result.contentHash, result.contentType);
  result.vaultStatus = stored.status;
  result.vaultKey = stored.key;
  if (stored.key) {
    await db`
      UPDATE source_documents
         SET document_r2_key = ${stored.key},
             content_type = ${result.contentType},
             byte_size = ${result.body.byteLength}
       WHERE id = ${sourceDocumentId}
    `;
  } else if (stored.error) {
    console.error(`Document vault store failed for institution ${result.institutionId}: ${stored.error}`);
  }
}

export async function runMagellanFetch(
  options: RunMagellanFetchOptions,
): Promise<RunMagellanFetchResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const rows = await selectCandidates(db, limit, options.institutionId, options.stateCode, Boolean(options.newLinksOnly));
  const learning = !dryRun && rows.length > 0 && (await learningSchemaReady(db));
  const vaultSchema = learning && (await documentVaultSchemaReady(db));
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;

  const results: FetchResult[] = [];
  let supersededCopies = 0;
  for (const row of rows) {
    const previous = await loadPreviousDocument(db, row, learning, vaultSchema);
    const result = await fetchCandidate(row, fetchImpl, previous);
    results.push(result);
    if (dryRun) continue;
    const sourceDocumentId = await recordFetchResult(db, result, learning);
    // The copy this fetch stored or confirmed is the page's current one.
    if (result.outcome === "success" || result.outcome === "unchanged") {
      supersededCopies += await markCurrentCopy(db, sourceDocumentId);
    }
    if (linkIsGone(result)) {
      if (isErrorPageLink(result.sourceUrl)) result.reason = "Link is the site's error page, not a fee schedule";
      result.sentBackToDiscovery = await sendGoneLinkToDiscovery(db, result, row.fee_schedule_url);
    }
    // New content is always stored; an unchanged document is stored once if it predates the vault.
    if (vaultOn && (result.outcome === "success" || (result.outcome === "unchanged" && !previous?.vaultKey))) {
      await storeInVault(db, vault, result, sourceDocumentId);
    }
    result.body = null;
    if (learning && result.attemptOutcome) {
      await recordAttempt(db, {
        institutionId: result.institutionId,
        sourceDocumentId,
        stage: "fetch",
        strategy: MAGELLAN_FETCH_STRATEGY.strategy,
        version: MAGELLAN_FETCH_STRATEGY.version,
        fingerprint: result.contentHash ?? result.sourceUrl,
        outcome: result.attemptOutcome,
        yieldCount: result.outcome === "success" ? 1 : 0,
        costMicrousd: 0,
        durationMs: result.durationMs,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: {
          url: result.finalUrl ?? result.sourceUrl,
          status_code: result.statusCode,
          document_type: result.documentType,
          bytes: result.bytes,
          vault: result.vaultStatus ?? (vaultOn ? null : vaultSchema ? "not_configured" : "schema_pending"),
          vault_key: result.vaultKey,
          reason: result.reason,
        },
      });
    }
  }

  // Companion pages ride on the same step, each stored as its own document stream. A
  // failure here never fails the fee-link fetch.
  let companions: RunCompanionFetchResult | null = null;
  let operatorSchedules: OperatorScheduleResult | null = null;
  let samePageCopies: SamePageCopyResult | null = null;
  if (!dryRun) {
    try {
      samePageCopies = await inSavepoint(db, (scope) =>
        supersedeSamePageCopies(scope, { runId: options.runId, institutionId: options.institutionId ?? null }),
      );
    } catch (error) {
      console.error("Same-page copies failed:", error);
    }
    // Schedules James found by hand join the companions before they are fetched.
    try {
      operatorSchedules = await inSavepoint(db, (scope) =>
        addOperatorSchedules({ db: scope, runId: options.runId, stepId: options.stepId ?? null }),
      );
    } catch (error) {
      console.error("Operator schedules failed:", error);
    }
    try {
      const companionVault = vault.configured && (await documentVaultSchemaReady(db)) ? vault : null;
      companions = await runCompanionFetch({
        db,
        fetchImpl,
        vault: companionVault,
        runId: options.runId,
        stepId: options.stepId ?? null,
        stateCode: options.stateCode ?? null,
        institutionId: options.institutionId ?? null,
      });
    } catch (error) {
      console.error("Companion fetch failed:", error);
    }
  }

  return {
    selected: rows.length,
    processed: results.length,
    succeeded: results.filter((result) => result.outcome === "success").length,
    unchanged: results.filter((result) => result.outcome === "unchanged").length,
    reusedDocuments: results.filter((result) => result.reusedDocument).length,
    failed: results.filter((result) => result.outcome === "failed").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    bytes: results.reduce((total, result) => total + result.bytes, 0),
    limit,
    dryRun,
    learning,
    storedDocuments: results.filter((result) => result.vaultStatus === "stored" || result.vaultStatus === "already_stored").length,
    vault: vaultOn ? "on" : vaultSchema ? "not_configured" : "schema_pending",
    outcomes: countOutcomes(results.map((result) => result.attemptOutcome)),
    supersededCopies,
    companions,
    operatorSchedules,
    samePageCopies,
    results,
  };
}
