import { sql } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { CRAWLER_USER_AGENT } from "@/lib/agents/crawler-identity";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const MAGELLAN_DISCOVERY_DEFAULT_LIMIT = 25;
export const MAGELLAN_DISCOVERY_MAX_LIMIT = 50;
export const MAGELLAN_DISCOVERY_MIN_CONFIDENCE = 0.72;

const DISCOVERY_METHOD = "magellan_agentic_discovery";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LINKS_TO_SCORE = 120;
const MAX_CANDIDATE_FETCHES = 3;

const FEE_CONTENT_KEYWORDS = [
  "monthly maintenance fee",
  "overdraft fee",
  "nsf fee",
  "insufficient funds",
  "atm fee",
  "wire transfer fee",
  "service charge",
  "account fee",
  "statement fee",
  "returned item",
  "stop payment",
  "truth in savings",
  "schedule of fees",
  "fee schedule",
  "fee disclosure",
];

const STRONG_LINK_PHRASES = [
  "schedule of fees",
  "fee schedule",
  "fee disclosure",
  "fee disclosures",
  "truth in savings",
  "service charges",
  "consumer fees",
  "business fees",
  "account fees",
  "rates and fees",
];

const MEDIUM_LINK_PHRASES = [
  "fees",
  "disclosures",
  "documents",
  "forms",
  "terms",
  "rates",
  "personal checking",
  "business checking",
];

const NEGATIVE_LINK_PHRASES = [
  "privacy",
  "career",
  "jobs",
  "mortgage",
  "loan rates",
  "donation",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "complaint",
  "annual report",
];

const COMMON_PATHS = [
  "/fees",
  "/fee-schedule",
  "/fee-schedule.pdf",
  "/schedule-of-fees",
  "/schedule-of-fees.pdf",
  "/rates-and-fees",
  "/personal/fees",
  "/personal-banking/fees",
  "/personal/checking/fees",
  "/personal/disclosures",
  "/disclosures",
  "/resources/disclosures",
  "/documents/fee-schedule",
  "/wp-content/uploads/fee-schedule.pdf",
];

interface DiscoveryCandidateRow {
  id: number | string;
  institution_name: string;
  state_code: string | null;
  website_url: string | null;
  asset_size: number | string | null;
  rescue_status: string | null;
  profile_canonical_source_url?: string | null;
  profile_source_kind?: string | null;
  profile_read_strategy?: string | null;
  profile_locked_by_correction?: boolean | string | null;
}

interface LinkCandidate {
  url: string;
  label: string;
  score: number;
  source: "homepage_link" | "common_path";
  reasons: string[];
}

type DiscoveryOutcome = "discovered" | "dead" | "needs_human" | "retry_after" | "failure";

interface CandidateDiscoveryResult {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  outcome: DiscoveryOutcome;
  url: string | null;
  documentType: string | null;
  confidence: number | null;
  reason: string;
  method: string;
  attemptedUrls: number;
}

export interface RunMagellanDiscoveryOptions {
  runId: number;
  mode?: "discover" | "rescue";
  limit?: number;
  dryRun?: boolean;
  stateCode?: string;
  db?: SqlTag;
  fetchImpl?: Fetcher;
}

export interface RunMagellanDiscoveryResult {
  selected: number;
  processed: number;
  discovered: number;
  dead: number;
  needsHuman: number;
  retryAfter: number;
  failures: number;
  attemptedUrls: number;
  limit: number;
  dryRun: boolean;
  results: CandidateDiscoveryResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAGELLAN_DISCOVERY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAGELLAN_DISCOVERY_MAX_LIMIT);
}

function normalizeWebsiteUrl(value: string | null): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
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

function lockedByCorrection(row: DiscoveryCandidateRow): boolean {
  return row.profile_locked_by_correction === true ||
    String(row.profile_locked_by_correction ?? "").toLowerCase() === "true";
}

function profileDocumentType(row: DiscoveryCandidateRow): string | null {
  return row.profile_source_kind === "pdf" || row.profile_source_kind === "html"
    ? row.profile_source_kind
    : null;
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCandidateUrl(rawHref: string, baseUrl: URL): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }

  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.replace(/^www\./, "") !== baseUrl.hostname.replace(/^www\./, "")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function scoreCandidate(url: string, label: string, source: LinkCandidate["source"]): LinkCandidate {
  const lower = `${label} ${url}`.toLowerCase().replace(/[-_]+/g, " ");
  let score = source === "common_path" ? 0.45 : 0.3;
  const reasons: string[] = [];

  for (const phrase of STRONG_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score += 0.35;
      reasons.push(phrase);
    }
  }
  for (const phrase of MEDIUM_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score += 0.12;
      reasons.push(phrase);
    }
  }
  for (const phrase of NEGATIVE_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 0.35;
      reasons.push(`negative:${phrase}`);
    }
  }
  if (url.toLowerCase().endsWith(".pdf")) {
    score += 0.1;
    reasons.push("pdf");
  }

  return {
    url,
    label,
    score: Math.max(0, Math.min(score, 0.98)),
    source,
    reasons,
  };
}

function extractLinkCandidates(html: string, baseUrl: URL): LinkCandidate[] {
  const candidates = new Map<string, LinkCandidate>();
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && candidates.size < MAX_LINKS_TO_SCORE) {
    const url = normalizeCandidateUrl(match[1], baseUrl);
    if (!url) continue;
    const label = cleanText(match[2]).slice(0, 140);
    const scored = scoreCandidate(url, label, "homepage_link");
    if (scored.score >= 0.5) candidates.set(url, scored);
  }

  for (const path of COMMON_PATHS) {
    const url = new URL(path, baseUrl.origin).toString();
    const scored = scoreCandidate(url, path, "common_path");
    const current = candidates.get(url);
    if (!current || scored.score > current.score) candidates.set(url, scored);
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.score >= MAGELLAN_DISCOVERY_MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATE_FETCHES);
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
        Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateLinkCandidate(
  candidate: LinkCandidate,
  fetchImpl: Fetcher,
): Promise<{ ok: boolean; documentType: string | null; confidence: number; reason: string }> {
  const response = await fetchWithTimeout(fetchImpl, candidate.url);
  if (!response.ok) {
    return {
      ok: false,
      documentType: null,
      confidence: 0,
      reason: `Candidate HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikePdf = contentType.includes("application/pdf") || candidate.url.toLowerCase().endsWith(".pdf");
  if (looksLikePdf) {
    return {
      ok: true,
      documentType: "pdf",
      confidence: Math.max(candidate.score, 0.82),
      reason: `PDF candidate matched ${candidate.reasons.join(", ") || "fee URL pattern"}`,
    };
  }

  if (!contentType.includes("text/html")) {
    return {
      ok: false,
      documentType: null,
      confidence: 0,
      reason: `Unsupported content type ${contentType || "unknown"}`,
    };
  }

  const body = (await response.text()).toLowerCase();
  const keywordMatches = FEE_CONTENT_KEYWORDS.filter((keyword) => body.includes(keyword)).length;
  if (keywordMatches >= 2 || (candidate.score >= 0.88 && keywordMatches >= 1)) {
    return {
      ok: true,
      documentType: "html",
      confidence: Math.max(candidate.score, keywordMatches >= 2 ? 0.84 : 0.78),
      reason: `${keywordMatches} fee keywords found on candidate page`,
    };
  }

  return {
    ok: false,
    documentType: null,
    confidence: candidate.score,
    reason: `${keywordMatches} fee keywords found on candidate page`,
  };
}

async function discoverForInstitution(
  row: DiscoveryCandidateRow,
  fetchImpl: Fetcher,
): Promise<CandidateDiscoveryResult> {
  const institutionId = Number(row.id);
  const institutionName = String(row.institution_name);
  const stateCode = normalizeStateCode(row.state_code);
  const correctedUrl = lockedByCorrection(row)
    ? normalizeHttpUrl(row.profile_canonical_source_url)
    : null;
  if (correctedUrl) {
    return {
      institutionId,
      institutionName,
      stateCode,
      outcome: "discovered",
      url: correctedUrl,
      documentType: profileDocumentType(row),
      confidence: 1,
      reason: "Locked source correction supplied canonical source URL",
      method: DISCOVERY_METHOD,
      attemptedUrls: 0,
    };
  }

  const baseUrl = normalizeWebsiteUrl(row.website_url);
  if (!baseUrl) {
    return {
      institutionId,
      institutionName,
      stateCode,
      outcome: "needs_human",
      url: null,
      documentType: null,
      confidence: null,
      reason: "Invalid or missing website_url",
      method: DISCOVERY_METHOD,
      attemptedUrls: 0,
    };
  }

  let homepage: Response;
  try {
    homepage = await fetchWithTimeout(fetchImpl, baseUrl.toString());
  } catch (error) {
    return {
      institutionId,
      institutionName,
      stateCode,
      outcome: "retry_after",
      url: null,
      documentType: null,
      confidence: null,
      reason: `Homepage fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      method: DISCOVERY_METHOD,
      attemptedUrls: 1,
    };
  }

  if (!homepage.ok) {
    return {
      institutionId,
      institutionName,
      stateCode,
      outcome: "retry_after",
      url: null,
      documentType: null,
      confidence: null,
      reason: `Homepage HTTP ${homepage.status}`,
      method: DISCOVERY_METHOD,
      attemptedUrls: 1,
    };
  }

  const html = await homepage.text();
  const candidates = extractLinkCandidates(html, baseUrl);
  if (candidates.length === 0) {
    return {
      institutionId,
      institutionName,
      stateCode,
      outcome: "dead",
      url: null,
      documentType: null,
      confidence: null,
      reason: "No fee-like links found on homepage",
      method: DISCOVERY_METHOD,
      attemptedUrls: 1,
    };
  }

  let attemptedUrls = 1;
  let lastReason = "No candidate validated";
  for (const candidate of candidates) {
    attemptedUrls += 1;
    try {
      const validation = await validateLinkCandidate(candidate, fetchImpl);
      lastReason = validation.reason;
      if (validation.ok) {
        return {
          institutionId,
          institutionName,
          stateCode,
          outcome: "discovered",
          url: candidate.url,
          documentType: validation.documentType,
          confidence: validation.confidence,
          reason: validation.reason,
          method: DISCOVERY_METHOD,
          attemptedUrls,
        };
      }
    } catch (error) {
      lastReason = `Candidate fetch failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    institutionId,
    institutionName,
    stateCode,
    outcome: "dead",
    url: null,
    documentType: null,
    confidence: null,
    reason: lastReason,
    method: DISCOVERY_METHOD,
    attemptedUrls,
  };
}

async function selectCandidates(
  db: SqlTag,
  limit: number,
  stateCode?: string,
): Promise<DiscoveryCandidateRow[]> {
  const normalizedState = normalizeStateCode(stateCode);
  return db<DiscoveryCandidateRow[]>`
    SELECT inst.id,
           inst.institution_name,
           inst.state_code,
           inst.website_url,
           inst.asset_size,
           inst.rescue_status,
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.source_kind AS profile_source_kind,
           profile.read_strategy AS profile_read_strategy,
           profile.locked_by_correction AS profile_locked_by_correction
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
       AND inst.website_url IS NOT NULL
       AND btrim(inst.website_url) <> ''
       AND COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND (
         profile.locked_by_correction IS TRUE
         OR inst.last_rescue_attempt_at IS NULL
         OR inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
       )
     ORDER BY
       CASE WHEN profile.locked_by_correction IS TRUE AND profile.canonical_source_url IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.last_rescue_attempt_at IS NULL THEN 0 ELSE 1 END,
       inst.last_rescue_attempt_at NULLS FIRST,
       CASE WHEN inst.rescue_status = 'retry_after' THEN 1 ELSE 0 END,
       inst.asset_size DESC NULLS LAST,
       inst.id ASC
     LIMIT ${limit}
  `;
}

async function recordDiscoveryResult(
  db: SqlTag,
  result: CandidateDiscoveryResult,
): Promise<void> {
  const rescueStatus =
    result.outcome === "discovered"
      ? "rescued"
      : result.outcome === "needs_human"
        ? "needs_human"
        : result.outcome === "dead"
          ? "dead"
          : "retry_after";
  const failureReason = result.outcome === "discovered" ? null : `magellan_${result.outcome}`;
  const failureNote = result.outcome === "discovered" ? null : result.reason;

  await db`
    UPDATE institution_sources
       SET fee_schedule_url = COALESCE(${result.url}, fee_schedule_url),
           document_type = COALESCE(${result.documentType}, document_type),
           rescue_status = ${rescueStatus},
           last_rescue_attempt_at = NOW(),
           failure_reason = ${failureReason},
           failure_reason_note = ${failureNote},
           failure_reason_updated_at = CASE WHEN ${failureReason}::text IS NULL THEN failure_reason_updated_at ELSE NOW() END
     WHERE id = ${result.institutionId}
  `;
  await db`
    INSERT INTO agent_url_discovery_attempts
      (institution_id, discovery_method, attempted_at, result, found_url, error_message)
    VALUES
      (${result.institutionId}, ${DISCOVERY_METHOD}, NOW(), ${result.outcome}, ${result.url}, ${result.outcome === "discovered" ? null : result.reason})
    ON CONFLICT (institution_id, discovery_method)
    DO UPDATE SET
      attempted_at = EXCLUDED.attempted_at,
      result = EXCLUDED.result,
      found_url = EXCLUDED.found_url,
      error_message = EXCLUDED.error_message
  `;
  await db`
    INSERT INTO institution_source_profiles (
      institution_id,
      state_code,
      canonical_source_url,
      source_kind,
      read_strategy,
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
      ${result.url},
      ${result.outcome === "discovered" ? sourceKindFromDocumentType(result.documentType) : "unknown"},
      ${result.outcome === "discovered" ? readStrategyFromDocumentType(result.documentType) : null},
      CASE WHEN ${result.outcome} = 'discovered' THEN NOW() ELSE NULL END,
      CASE WHEN ${result.outcome} = 'discovered' THEN NULL ELSE NOW() END,
      ${result.outcome === "discovered" ? null : result.reason},
      CASE WHEN ${result.outcome} = 'discovered' THEN 0 ELSE 1 END,
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
        WHEN ${result.outcome} = 'discovered' THEN EXCLUDED.source_kind
        ELSE institution_source_profiles.source_kind
      END,
      read_strategy = CASE
        WHEN institution_source_profiles.locked_by_correction
          THEN institution_source_profiles.read_strategy
        WHEN ${result.outcome} = 'discovered' THEN EXCLUDED.read_strategy
        ELSE institution_source_profiles.read_strategy
      END,
      last_success_at = CASE
        WHEN ${result.outcome} = 'discovered' THEN NOW()
        ELSE institution_source_profiles.last_success_at
      END,
      last_failure_at = CASE
        WHEN ${result.outcome} = 'discovered' THEN NULL
        ELSE NOW()
      END,
      last_failure_reason = CASE
        WHEN ${result.outcome} = 'discovered' THEN NULL
        ELSE EXCLUDED.last_failure_reason
      END,
      consecutive_failures = CASE
        WHEN ${result.outcome} = 'discovered' THEN 0
        ELSE institution_source_profiles.consecutive_failures + 1
      END,
      updated_at = NOW()
  `;
}

export async function runMagellanDiscovery(
  options: RunMagellanDiscoveryOptions,
): Promise<RunMagellanDiscoveryResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const rows = await selectCandidates(db, limit, options.stateCode);

  const results: CandidateDiscoveryResult[] = [];
  for (const row of rows) {
    const result = await discoverForInstitution(row, fetchImpl);
    results.push(result);
    if (!dryRun) await recordDiscoveryResult(db, result);
  }

  return {
    selected: rows.length,
    processed: results.length,
    discovered: results.filter((result) => result.outcome === "discovered").length,
    dead: results.filter((result) => result.outcome === "dead").length,
    needsHuman: results.filter((result) => result.outcome === "needs_human").length,
    retryAfter: results.filter((result) => result.outcome === "retry_after").length,
    failures: results.filter((result) => result.outcome === "failure").length,
    attemptedUrls: results.reduce((total, result) => total + result.attemptedUrls, 0),
    limit,
    dryRun,
    results,
  };
}
