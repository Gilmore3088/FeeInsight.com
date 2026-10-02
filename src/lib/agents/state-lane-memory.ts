import { sql, withTransaction } from "@/lib/data-store/connection";
import { safeJsonb, toISO } from "@/lib/pg-helpers";
import { STATE_NAMES } from "@/lib/us-states";

type SqlTag = typeof sql;

export type AtlasStateLaneStatus = "running" | "due" | "attention" | "scheduled";
export type StateSourceKind = "pdf" | "html" | "scanned_pdf" | "unknown" | "offline";
export type StateReadStrategy = "pdf_text" | "html_dom" | "browser_render" | "ocr" | "manual_review";

export interface StateLaneMemorySyncResult {
  stateCode: string | null;
  lanesTouched: number;
  profilesTouched: number;
  backlogMissingUrls: number;
  backlogStaleSources: number;
  backlogOcr: number;
  backlogManualReview: number;
  failures: number;
  corrections: number;
}

export interface StateLaneHealth {
  stateCode: string;
  priorityScore: number;
  freshnessTargetHours: number;
  backlogMissingUrls: number;
  backlogStaleSources: number;
  backlogOcr: number;
  backlogManualReview: number;
  failures: number;
  corrections: number;
  lastAgentRunId: number | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAfter: string | null;
  profileCount: number;
  sourceKinds: {
    pdf: number;
    html: number;
    scannedPdf: number;
    unknown: number;
    offline: number;
  };
  readStrategies: {
    pdfText: number;
    htmlDom: number;
    browserRender: number;
    ocr: number;
    manualReview: number;
  };
  publicFindings: {
    unverified: number;
    verified: number;
    critical: number;
  };
}

export interface StatePublicDiscoveryFinding {
  id: number;
  stateCode: string | null;
  routeTemplate: string | null;
  url: string;
  issueCode: string;
  severity: "info" | "warning" | "critical";
  verifiedStatus: "unverified" | "verified" | "dismissed";
  message: string;
  agentRunId: number | null;
  observationId: number | null;
  statusCode: number | null;
  finalUrl: string | null;
  viewport: string | null;
  h1: string | null;
  title: string | null;
  observedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  clusterSize: number;
  systemicCandidate: boolean;
}

export interface StateSourceMemoryProfile {
  institutionId: number;
  institutionName: string;
  city: string | null;
  websiteUrl: string | null;
  feeScheduleUrl: string | null;
  canonicalSourceUrl: string | null;
  sourceKind: StateSourceKind;
  readStrategy: StateReadStrategy | null;
  lockedByCorrection: boolean;
  correctionVersion: number;
  correctionCount: number;
  latestCorrectionType: string | null;
  latestCorrectionAt: string | null;
  consecutiveFailures: number;
  lastFailureReason: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessfulSourceDocumentId: number | null;
  lastSuccessfulTextId: number | null;
  updatedAt: string | null;
}

export type PublicDiscoveryFindingDecision = "verified" | "dismissed";

export interface PublicDiscoveryFindingDecisionResult {
  success: boolean;
  findingId?: number;
  stateCode?: string;
  status?: PublicDiscoveryFindingDecision;
  error?: string;
}

export interface StateSourceMemoryCorrectionResult {
  success: boolean;
  institutionId?: number;
  stateCode?: string;
  correctionId?: number;
  correctionVersion?: number;
  error?: string;
}

export interface AtlasStateLaneDispatchRow {
  stateCode: string;
  name: string;
  status: AtlasStateLaneStatus;
  priorityScore: number;
  backlogMissingUrls: number;
  backlogStaleSources: number;
  backlogOcr: number;
  backlogManualReview: number;
  failures: number;
  corrections: number;
  publicFindings: number;
  criticalPublicFindings: number;
  lastAgentRunId: number | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAfter: string | null;
  activeRunId: number | null;
  activeRunStatus: string | null;
}

export interface AtlasStateLaneOption {
  stateCode: string;
  name: string;
}

export interface AtlasStateLaneDispatch {
  schemaReady: boolean;
  generatedAt: string;
  totalLanes: number;
  dueLanes: number;
  runningLanes: number;
  attentionLanes: number;
  totalMissingUrls: number;
  totalStaleSources: number;
  totalOcrBacklog: number;
  totalManualBacklog: number;
  totalFailures: number;
  totalCorrections: number;
  totalPublicFindings: number;
  totalCriticalPublicFindings: number;
  nextDueAfter: string | null;
  latestRunAt: string | null;
  rows: AtlasStateLaneDispatchRow[];
  stateOptions: AtlasStateLaneOption[];
}

export function normalizeStateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : null;
}

function numberFrom(value: unknown): number {
  return Number(value ?? 0);
}

function isMissingStateLaneSchemaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("agent_state_lanes") ||
    message.includes("institution_source_profiles") ||
    message.includes("institution_source_corrections") ||
    message.includes("does not exist") ||
    message.includes("undefined_table");
}

function emptySyncResult(stateCode: string | null): StateLaneMemorySyncResult {
  return {
    stateCode,
    lanesTouched: 0,
    profilesTouched: 0,
    backlogMissingUrls: 0,
    backlogStaleSources: 0,
    backlogOcr: 0,
    backlogManualReview: 0,
    failures: 0,
    corrections: 0,
  };
}

function emptyDispatch(schemaReady = true): AtlasStateLaneDispatch {
  return {
    schemaReady,
    generatedAt: new Date().toISOString(),
    totalLanes: 0,
    dueLanes: 0,
    runningLanes: 0,
    attentionLanes: 0,
    totalMissingUrls: 0,
    totalStaleSources: 0,
    totalOcrBacklog: 0,
    totalManualBacklog: 0,
    totalFailures: 0,
    totalCorrections: 0,
    totalPublicFindings: 0,
    totalCriticalPublicFindings: 0,
    nextDueAfter: null,
    latestRunAt: null,
    rows: [],
    stateOptions: [],
  };
}

function stateName(stateCode: string): string {
  return STATE_NAMES[stateCode] ?? stateCode;
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(Number(value))));
}

function safeSeverity(value: unknown): StatePublicDiscoveryFinding["severity"] {
  if (value === "critical" || value === "warning" || value === "info") return value;
  return "warning";
}

function safeVerifiedStatus(value: unknown): StatePublicDiscoveryFinding["verifiedStatus"] {
  if (value === "verified" || value === "dismissed" || value === "unverified") return value;
  return "unverified";
}

function safeSourceKind(value: unknown): StateSourceKind {
  if (
    value === "pdf" ||
    value === "html" ||
    value === "scanned_pdf" ||
    value === "offline" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function safeReadStrategy(value: unknown): StateReadStrategy | null {
  if (
    value === "pdf_text" ||
    value === "html_dom" ||
    value === "browser_render" ||
    value === "ocr" ||
    value === "manual_review"
  ) {
    return value;
  }
  return null;
}

function publicDiscoveryEvidence(value: unknown): Record<string, unknown> {
  const parsed = safeJsonb<Record<string, unknown>>(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function publicFindingClusterSize(evidence: Record<string, unknown>): number {
  const value = Number(evidence.darwin_cluster_size ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

function publicFindingSystemicCandidate(evidence: Record<string, unknown>): boolean {
  return evidence.systemic_candidate === true || evidence.systemic_candidate === "true";
}

export function sourceKindFromDocumentType(value: string | null | undefined): "pdf" | "html" | "unknown" {
  if (value === "pdf") return "pdf";
  if (value === "html") return "html";
  return "unknown";
}

export function readStrategyFromDocumentType(value: string | null | undefined): "pdf_text" | "html_dom" | null {
  if (value === "pdf") return "pdf_text";
  if (value === "html" || value === "text") return "html_dom";
  return null;
}

function normalizeCorrectionUrl(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function correctionTypeForSourceMemory({
  sourceKind,
  readStrategy,
  canonicalSourceUrl,
}: {
  sourceKind: StateSourceKind;
  readStrategy: StateReadStrategy | null;
  canonicalSourceUrl: string | null;
}): "canonical_source_url" | "source_kind" | "read_strategy" | "offline" | "manual_review" {
  if (sourceKind === "offline") return "offline";
  if (readStrategy === "manual_review") return "manual_review";
  if (canonicalSourceUrl) return "canonical_source_url";
  if (readStrategy) return "read_strategy";
  return "source_kind";
}

export async function syncStateLaneProfiles(
  db: SqlTag = sql,
  stateCode?: string | null,
): Promise<StateLaneMemorySyncResult> {
  const normalizedState = normalizeStateCode(stateCode ?? null);

  try {
    const lanes = await db`
      INSERT INTO public.agent_state_lanes (state_code, next_run_after, created_at, updated_at)
      SELECT DISTINCT upper(btrim(state_code)), NOW(), NOW(), NOW()
        FROM public.institution_sources
       WHERE state_code IS NOT NULL
         AND btrim(state_code) <> ''
         AND (${normalizedState}::text IS NULL OR upper(btrim(state_code)) = ${normalizedState})
      ON CONFLICT (state_code) DO NOTHING
      RETURNING state_code
    `;

    const profiles = await db`
      INSERT INTO public.institution_source_profiles (
        institution_id,
        state_code,
        canonical_source_url,
        source_kind,
        read_strategy,
        last_source_hash,
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
        NULLIF(btrim(inst.fee_schedule_url), ''),
        CASE
          WHEN inst.document_type IN ('pdf', 'html') THEN inst.document_type
          WHEN inst.document_type IN ('offline', 'no_website') THEN 'offline'
          WHEN inst.fee_schedule_url ILIKE '%.pdf%' THEN 'pdf'
          WHEN inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> '' THEN 'unknown'
          ELSE 'unknown'
        END,
        CASE
          WHEN inst.document_type = 'pdf' OR inst.fee_schedule_url ILIKE '%.pdf%' THEN 'pdf_text'
          WHEN inst.document_type = 'html' THEN 'html_dom'
          WHEN inst.document_type IN ('offline', 'no_website') THEN 'manual_review'
          ELSE NULL
        END,
        inst.last_content_hash,
        inst.last_success_at,
        CASE WHEN inst.failure_reason IS NOT NULL THEN inst.failure_reason_updated_at ELSE NULL END,
        inst.failure_reason_note,
        COALESCE(inst.consecutive_failures, 0),
        NOW(),
        NOW()
      FROM public.institution_sources inst
      WHERE inst.state_code IS NOT NULL
        AND btrim(inst.state_code) <> ''
        AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
      ON CONFLICT (institution_id) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        canonical_source_url = CASE
          WHEN public.institution_source_profiles.locked_by_correction
            THEN public.institution_source_profiles.canonical_source_url
          ELSE COALESCE(public.institution_source_profiles.canonical_source_url, EXCLUDED.canonical_source_url)
        END,
        source_kind = CASE
          WHEN public.institution_source_profiles.locked_by_correction
            THEN public.institution_source_profiles.source_kind
          -- Rosetta learned from the bytes that this PDF is a scan; the URL-based guess
          -- here must not flip it back to 'pdf' (and out of the OCR backlog).
          WHEN public.institution_source_profiles.source_kind = 'scanned_pdf'
               AND EXCLUDED.source_kind IN ('pdf', 'unknown')
            THEN public.institution_source_profiles.source_kind
          ELSE EXCLUDED.source_kind
        END,
        read_strategy = CASE
          WHEN public.institution_source_profiles.locked_by_correction
            THEN public.institution_source_profiles.read_strategy
          ELSE COALESCE(public.institution_source_profiles.read_strategy, EXCLUDED.read_strategy)
        END,
        updated_at = NOW()
      RETURNING institution_id
    `;

    await db`
    WITH lane_counts AS (
      SELECT
        upper(btrim(inst.state_code)) AS state_code,
        COUNT(*) FILTER (
          WHERE COALESCE(inst.status, 'active') = 'active'
            AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
            AND inst.website_url IS NOT NULL
            AND btrim(inst.website_url) <> ''
        )::int AS missing_urls,
        COUNT(*) FILTER (
          WHERE COALESCE(inst.status, 'active') = 'active'
            AND inst.fee_schedule_url IS NOT NULL
            AND btrim(inst.fee_schedule_url) <> ''
            AND (
              inst.last_crawl_at IS NULL
              OR inst.last_crawl_at < NOW() - INTERVAL '7 days'
            )
        )::int AS stale_sources,
        COUNT(*) FILTER (WHERE profile.read_strategy = 'ocr')::int AS ocr_backlog,
        COUNT(*) FILTER (
          WHERE profile.read_strategy = 'manual_review'
        )::int AS manual_backlog,
        COUNT(*) FILTER (
          WHERE COALESCE(profile.consecutive_failures, inst.consecutive_failures, 0) > 0
        )::int AS failures
      FROM public.institution_sources inst
      LEFT JOIN public.institution_source_profiles profile
        ON profile.institution_id = inst.id
      WHERE inst.state_code IS NOT NULL
        AND btrim(inst.state_code) <> ''
        AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
      GROUP BY upper(btrim(inst.state_code))
    ),
    correction_counts AS (
      SELECT upper(btrim(inst.state_code)) AS state_code,
             COUNT(*)::int AS corrections
        FROM public.institution_source_corrections correction
        JOIN public.institution_sources inst ON inst.id = correction.institution_id
       WHERE inst.state_code IS NOT NULL
         AND btrim(inst.state_code) <> ''
         AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       GROUP BY upper(btrim(inst.state_code))
    )
    UPDATE public.agent_state_lanes lane
       SET backlog_missing_urls = lane_counts.missing_urls,
           backlog_stale_sources = lane_counts.stale_sources,
           backlog_ocr = lane_counts.ocr_backlog,
           backlog_manual_review = lane_counts.manual_backlog,
           failure_count = lane_counts.failures,
           correction_count = COALESCE(correction_counts.corrections, 0),
           updated_at = NOW()
      FROM lane_counts
      LEFT JOIN correction_counts ON correction_counts.state_code = lane_counts.state_code
     WHERE lane.state_code = lane_counts.state_code
    `;

    const [summary] = await db`
      SELECT
        COALESCE(SUM(backlog_missing_urls), 0)::int AS missing_urls,
        COALESCE(SUM(backlog_stale_sources), 0)::int AS stale_sources,
        COALESCE(SUM(backlog_ocr), 0)::int AS ocr_backlog,
        COALESCE(SUM(backlog_manual_review), 0)::int AS manual_backlog,
        COALESCE(SUM(failure_count), 0)::int AS failures,
        COALESCE(SUM(correction_count), 0)::int AS corrections
      FROM public.agent_state_lanes
      WHERE ${normalizedState}::text IS NULL OR state_code = ${normalizedState}
    `;

    return {
      stateCode: normalizedState,
      lanesTouched: lanes.length,
      profilesTouched: profiles.length,
      backlogMissingUrls: numberFrom(summary?.missing_urls),
      backlogStaleSources: numberFrom(summary?.stale_sources),
      backlogOcr: numberFrom(summary?.ocr_backlog),
      backlogManualReview: numberFrom(summary?.manual_backlog),
      failures: numberFrom(summary?.failures),
      corrections: numberFrom(summary?.corrections),
    };
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) return emptySyncResult(normalizedState);
    throw error;
  }
}

export async function getStateLaneHealth(
  stateCode: string,
  db: SqlTag = sql,
): Promise<StateLaneHealth | null> {
  const normalizedState = normalizeStateCode(stateCode);
  if (!normalizedState) return null;

  try {
    await syncStateLaneProfiles(db, normalizedState);
    const [row] = await db`
      WITH profile_counts AS (
        SELECT
          COUNT(*)::int AS profile_count,
          COUNT(*) FILTER (WHERE source_kind = 'pdf')::int AS pdf_sources,
          COUNT(*) FILTER (WHERE source_kind = 'html')::int AS html_sources,
          COUNT(*) FILTER (WHERE source_kind = 'scanned_pdf')::int AS scanned_pdf_sources,
          COUNT(*) FILTER (WHERE source_kind = 'unknown')::int AS unknown_sources,
          COUNT(*) FILTER (WHERE source_kind = 'offline')::int AS offline_sources,
          COUNT(*) FILTER (WHERE read_strategy = 'pdf_text')::int AS pdf_text_reads,
          COUNT(*) FILTER (WHERE read_strategy = 'html_dom')::int AS html_dom_reads,
          COUNT(*) FILTER (WHERE read_strategy = 'browser_render')::int AS browser_render_reads,
          COUNT(*) FILTER (WHERE read_strategy = 'ocr')::int AS ocr_reads,
          COUNT(*) FILTER (WHERE read_strategy = 'manual_review')::int AS manual_review_reads
        FROM public.institution_source_profiles
        WHERE state_code = ${normalizedState}
      ),
      finding_counts AS (
        SELECT
          COUNT(*) FILTER (WHERE verified_status = 'unverified')::int AS unverified_findings,
          COUNT(*) FILTER (WHERE verified_status = 'verified')::int AS verified_findings,
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_findings
        FROM public.public_discovery_findings
        WHERE state_code = ${normalizedState}
      )
      SELECT
        lane.state_code,
        lane.priority_score,
        lane.freshness_target_hours,
        lane.backlog_missing_urls,
        lane.backlog_stale_sources,
        lane.backlog_ocr,
        lane.backlog_manual_review,
        lane.failure_count,
        lane.correction_count,
        lane.last_agent_run_id,
        lane.last_run_at,
        lane.last_success_at,
        lane.next_run_after,
        profile_counts.*,
        finding_counts.*
      FROM public.agent_state_lanes lane
      CROSS JOIN profile_counts
      CROSS JOIN finding_counts
      WHERE lane.state_code = ${normalizedState}
      LIMIT 1
    `;
    if (!row) return null;
    return {
      stateCode: String(row.state_code),
      priorityScore: numberFrom(row.priority_score),
      freshnessTargetHours: numberFrom(row.freshness_target_hours),
      backlogMissingUrls: numberFrom(row.backlog_missing_urls),
      backlogStaleSources: numberFrom(row.backlog_stale_sources),
      backlogOcr: numberFrom(row.backlog_ocr),
      backlogManualReview: numberFrom(row.backlog_manual_review),
      failures: numberFrom(row.failure_count),
      corrections: numberFrom(row.correction_count),
      lastAgentRunId: row.last_agent_run_id == null ? null : Number(row.last_agent_run_id),
      lastRunAt: toISO(row.last_run_at as string | Date | null),
      lastSuccessAt: toISO(row.last_success_at as string | Date | null),
      nextRunAfter: toISO(row.next_run_after as string | Date | null),
      profileCount: numberFrom(row.profile_count),
      sourceKinds: {
        pdf: numberFrom(row.pdf_sources),
        html: numberFrom(row.html_sources),
        scannedPdf: numberFrom(row.scanned_pdf_sources),
        unknown: numberFrom(row.unknown_sources),
        offline: numberFrom(row.offline_sources),
      },
      readStrategies: {
        pdfText: numberFrom(row.pdf_text_reads),
        htmlDom: numberFrom(row.html_dom_reads),
        browserRender: numberFrom(row.browser_render_reads),
        ocr: numberFrom(row.ocr_reads),
        manualReview: numberFrom(row.manual_review_reads),
      },
      publicFindings: {
        unverified: numberFrom(row.unverified_findings),
        verified: numberFrom(row.verified_findings),
        critical: numberFrom(row.critical_findings),
      },
    };
  } catch (error) {
    console.error("getStateLaneHealth failed:", error);
    return null;
  }
}

export async function getStateSourceMemoryProfiles(
  stateCode: string,
  options: { limit?: number } = {},
  db: SqlTag = sql,
): Promise<StateSourceMemoryProfile[]> {
  const normalizedState = normalizeStateCode(stateCode);
  if (!normalizedState) return [];
  const limit = boundedLimit(options.limit, 15, 75);

  try {
    await syncStateLaneProfiles(db, normalizedState);
    const rows = await db`
      SELECT
        inst.id AS institution_id,
        inst.institution_name,
        inst.city,
        inst.website_url,
        inst.fee_schedule_url,
        profile.canonical_source_url,
        profile.source_kind,
        profile.read_strategy,
        profile.locked_by_correction,
        profile.correction_version,
        profile.consecutive_failures,
        profile.last_failure_reason,
        profile.last_failure_at,
        profile.last_success_at,
        profile.last_successful_source_document_id,
        profile.last_successful_text_id,
        profile.updated_at,
        COALESCE(corrections.correction_count, 0)::int AS correction_count,
        corrections.latest_correction_type,
        corrections.latest_correction_at
      FROM public.institution_source_profiles profile
      JOIN public.institution_sources inst
        ON inst.id = profile.institution_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS correction_count,
          (ARRAY_AGG(correction.correction_type ORDER BY correction.created_at DESC, correction.id DESC))[1] AS latest_correction_type,
          MAX(correction.created_at) AS latest_correction_at
        FROM public.institution_source_corrections correction
        WHERE correction.institution_id = profile.institution_id
          AND correction.accepted IS TRUE
      ) corrections ON TRUE
      WHERE profile.state_code = ${normalizedState}
      ORDER BY
        CASE WHEN profile.locked_by_correction IS TRUE THEN 0 ELSE 1 END ASC,
        CASE WHEN profile.read_strategy IN ('ocr', 'manual_review') THEN 0 ELSE 1 END ASC,
        CASE WHEN profile.consecutive_failures > 0 THEN 0 ELSE 1 END ASC,
        CASE WHEN profile.source_kind IN ('unknown', 'scanned_pdf', 'offline') THEN 0 ELSE 1 END ASC,
        profile.consecutive_failures DESC,
        corrections.latest_correction_at DESC NULLS LAST,
        profile.updated_at DESC,
        inst.institution_name ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      institutionId: Number(row.institution_id),
      institutionName: String(row.institution_name),
      city: row.city == null ? null : String(row.city),
      websiteUrl: row.website_url == null ? null : String(row.website_url),
      feeScheduleUrl: row.fee_schedule_url == null ? null : String(row.fee_schedule_url),
      canonicalSourceUrl: row.canonical_source_url == null ? null : String(row.canonical_source_url),
      sourceKind: safeSourceKind(row.source_kind),
      readStrategy: safeReadStrategy(row.read_strategy),
      lockedByCorrection: row.locked_by_correction === true ||
        String(row.locked_by_correction ?? "").toLowerCase() === "true",
      correctionVersion: numberFrom(row.correction_version),
      correctionCount: numberFrom(row.correction_count),
      latestCorrectionType: row.latest_correction_type == null ? null : String(row.latest_correction_type),
      latestCorrectionAt: toISO(row.latest_correction_at as string | Date | null),
      consecutiveFailures: numberFrom(row.consecutive_failures),
      lastFailureReason: row.last_failure_reason == null ? null : String(row.last_failure_reason),
      lastFailureAt: toISO(row.last_failure_at as string | Date | null),
      lastSuccessAt: toISO(row.last_success_at as string | Date | null),
      lastSuccessfulSourceDocumentId: row.last_successful_source_document_id == null
        ? null
        : Number(row.last_successful_source_document_id),
      lastSuccessfulTextId: row.last_successful_text_id == null
        ? null
        : Number(row.last_successful_text_id),
      updatedAt: toISO(row.updated_at as string | Date | null),
    }));
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) return [];
    console.error("getStateSourceMemoryProfiles failed:", error);
    return [];
  }
}

export async function applyStateSourceMemoryCorrection({
  institutionId,
  stateCode,
  canonicalSourceUrl,
  sourceKind,
  readStrategy,
  reason,
  correctedBy,
  db,
}: {
  institutionId: number;
  stateCode: string;
  canonicalSourceUrl?: string | null;
  sourceKind: StateSourceKind;
  readStrategy?: StateReadStrategy | "" | null;
  reason?: string | null;
  correctedBy: string;
  db?: SqlTag;
}): Promise<StateSourceMemoryCorrectionResult> {
  const normalizedState = normalizeStateCode(stateCode);
  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    return { success: false, error: "Invalid institution id." };
  }
  if (!normalizedState) {
    return { success: false, error: "Invalid state code." };
  }
  if (safeSourceKind(sourceKind) !== sourceKind) {
    return { success: false, error: "Invalid source kind." };
  }
  const normalizedReadStrategy = readStrategy == null || readStrategy === ""
    ? null
    : safeReadStrategy(readStrategy);
  if (readStrategy && normalizedReadStrategy !== readStrategy) {
    return { success: false, error: "Invalid read strategy." };
  }
  const normalizedUrl = normalizeCorrectionUrl(canonicalSourceUrl);
  if (canonicalSourceUrl && !normalizedUrl) {
    return { success: false, error: "Canonical source URL must be a valid http(s) URL." };
  }

  const finalSourceKind = sourceKind;
  const finalReadStrategy = finalSourceKind === "offline"
    ? "manual_review"
    : normalizedReadStrategy;
  const finalCanonicalUrl = finalSourceKind === "offline" ? null : normalizedUrl;
  if (!finalCanonicalUrl && finalSourceKind !== "offline" && finalReadStrategy !== "manual_review") {
    return {
      success: false,
      error: "Canonical source URL is required unless the source is offline or marked for manual review.",
    };
  }
  const correctionType = correctionTypeForSourceMemory({
    sourceKind: finalSourceKind,
    readStrategy: finalReadStrategy,
    canonicalSourceUrl: finalCanonicalUrl,
  });
  const cleanedReason = String(reason ?? "").trim() || null;
  const cleanedCorrectedBy = String(correctedBy || "atlas").trim().slice(0, 120) || "atlas";

  const run = async (tx: SqlTag): Promise<StateSourceMemoryCorrectionResult> => {
    const [current] = await tx`
      SELECT
        inst.id,
        upper(btrim(inst.state_code)) AS state_code,
        inst.fee_schedule_url,
        inst.document_type,
        profile.canonical_source_url,
        profile.source_kind,
        profile.read_strategy,
        profile.correction_version
      FROM public.institution_sources inst
      LEFT JOIN public.institution_source_profiles profile
        ON profile.institution_id = inst.id
      WHERE inst.id = ${institutionId}
        AND upper(btrim(inst.state_code)) = ${normalizedState}
      LIMIT 1
    `;
    if (!current) {
      return {
        success: false,
        error: "Institution source profile was not found for this state lane.",
      };
    }

    const beforeValue = {
      fee_schedule_url: current.fee_schedule_url ?? null,
      document_type: current.document_type ?? null,
      canonical_source_url: current.canonical_source_url ?? null,
      source_kind: current.source_kind ?? null,
      read_strategy: current.read_strategy ?? null,
      correction_version: numberFrom(current.correction_version),
    };
    const afterValue = {
      canonical_source_url: finalCanonicalUrl,
      source_kind: finalSourceKind,
      read_strategy: finalReadStrategy,
      locked_by_correction: true,
      source: "atlas_state_lane",
    };

    const [profile] = await tx`
      INSERT INTO public.institution_source_profiles (
        institution_id,
        state_code,
        canonical_source_url,
        source_kind,
        read_strategy,
        correction_version,
        locked_by_correction,
        consecutive_failures,
        last_failure_at,
        last_failure_reason,
        created_at,
        updated_at
      )
      VALUES (
        ${institutionId},
        ${normalizedState},
        ${finalCanonicalUrl},
        ${finalSourceKind},
        ${finalReadStrategy},
        1,
        TRUE,
        0,
        NULL,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT (institution_id) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        canonical_source_url = EXCLUDED.canonical_source_url,
        source_kind = EXCLUDED.source_kind,
        read_strategy = EXCLUDED.read_strategy,
        correction_version = public.institution_source_profiles.correction_version + 1,
        locked_by_correction = TRUE,
        consecutive_failures = 0,
        last_failure_at = NULL,
        last_failure_reason = NULL,
        updated_at = NOW()
      RETURNING correction_version
    `;

    await tx`
      UPDATE public.institution_sources
         SET fee_schedule_url = ${finalCanonicalUrl},
             document_type = CASE
               WHEN ${finalSourceKind} = 'scanned_pdf' THEN 'pdf'
               WHEN ${finalSourceKind} = 'unknown' THEN document_type
               ELSE ${finalSourceKind}
             END,
             failure_reason = NULL,
             failure_reason_note = NULL,
             failure_reason_updated_at = NULL,
             consecutive_failures = 0
       WHERE id = ${institutionId}
         AND upper(btrim(state_code)) = ${normalizedState}
    `;

    const [correction] = await tx`
      INSERT INTO public.institution_source_corrections (
        institution_id,
        correction_type,
        before_value,
        after_value,
        reason,
        corrected_by,
        confidence,
        accepted,
        created_at
      )
      VALUES (
        ${institutionId},
        ${correctionType},
        ${JSON.stringify(beforeValue)}::jsonb,
        ${JSON.stringify(afterValue)}::jsonb,
        ${cleanedReason},
        ${cleanedCorrectedBy},
        1,
        TRUE,
        NOW()
      )
      RETURNING id
    `;

    await syncStateLaneProfiles(tx, normalizedState);

    return {
      success: true,
      institutionId,
      stateCode: normalizedState,
      correctionId: Number(correction.id),
      correctionVersion: numberFrom(profile?.correction_version),
    };
  };

  try {
    return await (db ? run(db) : withTransaction(run));
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) {
      return { success: false, error: "State lane source memory schema is not available." };
    }
    console.error("applyStateSourceMemoryCorrection failed:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getStatePublicDiscoveryFindings(
  stateCode: string,
  options: { limit?: number } = {},
  db: SqlTag = sql,
): Promise<StatePublicDiscoveryFinding[]> {
  const normalizedState = normalizeStateCode(stateCode);
  if (!normalizedState) return [];
  const limit = boundedLimit(options.limit, 12, 50);

  try {
    const rows = await db`
      SELECT
        finding.id,
        finding.state_code,
        finding.route_template,
        finding.url,
        finding.issue_code,
        finding.severity,
        finding.verified_status,
        finding.message,
        finding.evidence,
        finding.agent_run_id,
        finding.observation_id,
        finding.created_at,
        finding.updated_at,
        observation.status_code,
        observation.final_url,
        observation.viewport,
        observation.h1,
        observation.title,
        observation.observed_at
      FROM public.public_discovery_findings finding
      LEFT JOIN public.public_discovery_observations observation
        ON observation.id = finding.observation_id
      WHERE finding.state_code = ${normalizedState}
        AND finding.verified_status = 'unverified'
      ORDER BY
        CASE finding.severity
          WHEN 'critical' THEN 0
          WHEN 'warning' THEN 1
          ELSE 2
        END ASC,
        finding.created_at DESC,
        finding.id DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const evidence = publicDiscoveryEvidence(row.evidence);
      return {
        id: Number(row.id),
        stateCode: row.state_code == null ? null : String(row.state_code),
        routeTemplate: row.route_template == null ? null : String(row.route_template),
        url: String(row.url),
        issueCode: String(row.issue_code),
        severity: safeSeverity(row.severity),
        verifiedStatus: safeVerifiedStatus(row.verified_status),
        message: String(row.message),
        agentRunId: row.agent_run_id == null ? null : Number(row.agent_run_id),
        observationId: row.observation_id == null ? null : Number(row.observation_id),
        statusCode: row.status_code == null ? null : Number(row.status_code),
        finalUrl: row.final_url == null ? null : String(row.final_url),
        viewport: row.viewport == null ? null : String(row.viewport),
        h1: row.h1 == null ? null : String(row.h1),
        title: row.title == null ? null : String(row.title),
        observedAt: toISO(row.observed_at as string | Date | null),
        createdAt: toISO(row.created_at as string | Date | null),
        updatedAt: toISO(row.updated_at as string | Date | null),
        clusterSize: publicFindingClusterSize(evidence),
        systemicCandidate: publicFindingSystemicCandidate(evidence),
      };
    });
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) return [];
    console.error("getStatePublicDiscoveryFindings failed:", error);
    return [];
  }
}

export async function updatePublicDiscoveryFindingDecision({
  findingId,
  stateCode,
  status,
  decidedByUserId,
  decidedByUsername,
  db = sql,
}: {
  findingId: number;
  stateCode: string;
  status: PublicDiscoveryFindingDecision;
  decidedByUserId: number;
  decidedByUsername?: string | null;
  db?: SqlTag;
}): Promise<PublicDiscoveryFindingDecisionResult> {
  const normalizedState = normalizeStateCode(stateCode);
  if (!Number.isInteger(findingId) || findingId <= 0) {
    return { success: false, error: "Invalid public discovery finding id." };
  }
  if (!normalizedState) {
    return { success: false, error: "Invalid state code." };
  }
  if (status !== "verified" && status !== "dismissed") {
    return { success: false, error: "Invalid public discovery finding decision." };
  }

  try {
    const [row] = await db`
      UPDATE public.public_discovery_findings
         SET verified_status = ${status},
             evidence = (
               CASE
                 WHEN jsonb_typeof(evidence) = 'object' THEN evidence
                 ELSE '{}'::jsonb
               END
             ) || jsonb_build_object(
               'operator_decision',
               jsonb_build_object(
                 'status', ${status}::text,
                 'decided_at', NOW(),
                 'decided_by_user_id', ${decidedByUserId}::integer,
                 'decided_by_username', ${decidedByUsername ?? null}::text,
                 'source', 'atlas_state_lane'
               )
             ),
             updated_at = NOW()
       WHERE id = ${findingId}
         AND state_code = ${normalizedState}
         AND verified_status = 'unverified'
       RETURNING id, state_code, verified_status
    `;

    if (!row) {
      return {
        success: false,
        error: "Public discovery finding was not found, was already reviewed, or belongs to another state.",
      };
    }

    return {
      success: true,
      findingId: Number(row.id),
      stateCode: String(row.state_code),
      status: safeVerifiedStatus(row.verified_status) as PublicDiscoveryFindingDecision,
    };
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) {
      return { success: false, error: "Public discovery schema is not available." };
    }
    console.error("updatePublicDiscoveryFindingDecision failed:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getAtlasStateLaneDispatch(
  db: SqlTag = sql,
): Promise<AtlasStateLaneDispatch> {
  try {
    const [summary] = await db`
      WITH lane_base AS (
        SELECT
          lane.state_code,
          lane.backlog_missing_urls,
          lane.backlog_stale_sources,
          lane.backlog_ocr,
          lane.backlog_manual_review,
          lane.failure_count,
          lane.correction_count,
          lane.last_run_at,
          lane.next_run_after,
          run.status AS active_run_status,
          COALESCE(public_counts.public_findings, 0)::int AS public_findings,
          COALESCE(public_counts.critical_public_findings, 0)::int AS critical_public_findings
        FROM public.agent_state_lanes lane
        LEFT JOIN public.agent_runs run
          ON run.id = lane.last_agent_run_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS public_findings,
            COUNT(*) FILTER (WHERE finding.severity = 'critical')::int AS critical_public_findings
          FROM public.public_discovery_findings finding
          WHERE finding.state_code = lane.state_code
            AND finding.verified_status = 'unverified'
        ) public_counts ON TRUE
      )
      SELECT
        COUNT(*)::int AS total_lanes,
        COUNT(*) FILTER (WHERE next_run_after <= NOW())::int AS due_lanes,
        COUNT(*) FILTER (
          WHERE active_run_status IN ('queued', 'running', 'cancel_requested')
        )::int AS running_lanes,
        COUNT(*) FILTER (
          WHERE failure_count > 0
             OR backlog_ocr > 0
             OR backlog_manual_review > 0
             OR public_findings > 0
        )::int AS attention_lanes,
        COALESCE(SUM(backlog_missing_urls), 0)::int AS total_missing_urls,
        COALESCE(SUM(backlog_stale_sources), 0)::int AS total_stale_sources,
        COALESCE(SUM(backlog_ocr), 0)::int AS total_ocr_backlog,
        COALESCE(SUM(backlog_manual_review), 0)::int AS total_manual_backlog,
        COALESCE(SUM(failure_count), 0)::int AS total_failures,
        COALESCE(SUM(correction_count), 0)::int AS total_corrections,
        (
          SELECT COUNT(*)::int
            FROM public.public_discovery_findings
           WHERE verified_status = 'unverified'
        ) AS total_public_findings,
        (
          SELECT COUNT(*)::int
            FROM public.public_discovery_findings
           WHERE severity = 'critical'
             AND verified_status = 'unverified'
        ) AS total_critical_public_findings,
        MIN(next_run_after) AS next_due_after,
        MAX(last_run_at) AS latest_run_at
      FROM lane_base
    `;

    const rows = await db`
      SELECT
        lane.state_code,
        lane.priority_score,
        lane.backlog_missing_urls,
        lane.backlog_stale_sources,
        lane.backlog_ocr,
        lane.backlog_manual_review,
        lane.failure_count,
        lane.correction_count,
        COALESCE(public_counts.public_findings, 0)::int AS public_findings,
        COALESCE(public_counts.critical_public_findings, 0)::int AS critical_public_findings,
        lane.last_agent_run_id,
        lane.last_run_at,
        lane.last_success_at,
        lane.next_run_after,
        CASE
          WHEN run.status IN ('queued', 'running', 'cancel_requested') THEN run.id
          ELSE NULL
        END AS active_run_id,
        CASE
          WHEN run.status IN ('queued', 'running', 'cancel_requested') THEN run.status
          ELSE NULL
        END AS active_run_status,
        CASE
          WHEN run.status IN ('queued', 'running', 'cancel_requested') THEN 'running'
          WHEN COALESCE(public_counts.critical_public_findings, 0) > 0 THEN 'attention'
          WHEN lane.failure_count > 0 THEN 'attention'
          WHEN lane.backlog_ocr > 0 OR lane.backlog_manual_review > 0 THEN 'attention'
          WHEN COALESCE(public_counts.public_findings, 0) > 0 THEN 'attention'
          WHEN lane.next_run_after <= NOW() THEN 'due'
          ELSE 'scheduled'
        END AS lane_status
      FROM public.agent_state_lanes lane
      LEFT JOIN public.agent_runs run
        ON run.id = lane.last_agent_run_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS public_findings,
          COUNT(*) FILTER (WHERE finding.severity = 'critical')::int AS critical_public_findings
        FROM public.public_discovery_findings finding
        WHERE finding.state_code = lane.state_code
          AND finding.verified_status = 'unverified'
      ) public_counts ON TRUE
      ORDER BY
        CASE
          WHEN run.status IN ('queued', 'running', 'cancel_requested') THEN 0
          WHEN COALESCE(public_counts.critical_public_findings, 0) > 0 THEN 1
          WHEN lane.failure_count > 0 THEN 2
          WHEN lane.backlog_ocr > 0 OR lane.backlog_manual_review > 0 THEN 3
          WHEN COALESCE(public_counts.public_findings, 0) > 0 THEN 4
          WHEN lane.next_run_after <= NOW() THEN 5
          ELSE 6
        END ASC,
        lane.priority_score DESC,
        (
          lane.backlog_missing_urls
          + lane.backlog_stale_sources
          + lane.backlog_ocr
          + lane.backlog_manual_review
          + lane.failure_count
          + COALESCE(public_counts.public_findings, 0)
        ) DESC,
        lane.next_run_after ASC,
        lane.state_code ASC
      LIMIT 10
    `;

    const options = await db`
      SELECT state_code
        FROM public.agent_state_lanes
       ORDER BY state_code ASC
    `;

    return {
      schemaReady: true,
      generatedAt: new Date().toISOString(),
      totalLanes: numberFrom(summary?.total_lanes),
      dueLanes: numberFrom(summary?.due_lanes),
      runningLanes: numberFrom(summary?.running_lanes),
      attentionLanes: numberFrom(summary?.attention_lanes),
      totalMissingUrls: numberFrom(summary?.total_missing_urls),
      totalStaleSources: numberFrom(summary?.total_stale_sources),
      totalOcrBacklog: numberFrom(summary?.total_ocr_backlog),
      totalManualBacklog: numberFrom(summary?.total_manual_backlog),
      totalFailures: numberFrom(summary?.total_failures),
      totalCorrections: numberFrom(summary?.total_corrections),
      totalPublicFindings: numberFrom(summary?.total_public_findings),
      totalCriticalPublicFindings: numberFrom(summary?.total_critical_public_findings),
      nextDueAfter: toISO(summary?.next_due_after as string | Date | null),
      latestRunAt: toISO(summary?.latest_run_at as string | Date | null),
      rows: rows.map((row) => {
        const stateCode = String(row.state_code);
        return {
          stateCode,
          name: stateName(stateCode),
          status: String(row.lane_status ?? "scheduled") as AtlasStateLaneStatus,
          priorityScore: numberFrom(row.priority_score),
          backlogMissingUrls: numberFrom(row.backlog_missing_urls),
          backlogStaleSources: numberFrom(row.backlog_stale_sources),
          backlogOcr: numberFrom(row.backlog_ocr),
          backlogManualReview: numberFrom(row.backlog_manual_review),
          failures: numberFrom(row.failure_count),
          corrections: numberFrom(row.correction_count),
          publicFindings: numberFrom(row.public_findings),
          criticalPublicFindings: numberFrom(row.critical_public_findings),
          lastAgentRunId: row.last_agent_run_id == null ? null : Number(row.last_agent_run_id),
          lastRunAt: toISO(row.last_run_at as string | Date | null),
          lastSuccessAt: toISO(row.last_success_at as string | Date | null),
          nextRunAfter: toISO(row.next_run_after as string | Date | null),
          activeRunId: row.active_run_id == null ? null : Number(row.active_run_id),
          activeRunStatus: row.active_run_status == null ? null : String(row.active_run_status),
        };
      }),
      stateOptions: options.map((row) => {
        const stateCode = String(row.state_code);
        return { stateCode, name: stateName(stateCode) };
      }),
    };
  } catch (error) {
    if (isMissingStateLaneSchemaError(error)) return emptyDispatch(false);
    console.error("getAtlasStateLaneDispatch failed:", error);
    return emptyDispatch(true);
  }
}

export function correctionAfterValue(value: unknown): Record<string, unknown> {
  const parsed = safeJsonb<Record<string, unknown>>(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
