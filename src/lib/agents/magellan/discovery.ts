import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { documentVaultSchemaReady } from "@/lib/agents/document-vault";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { fetchWithTimeout } from "./find-validate";
import {
  FINDER_ORDER,
  FINDERS,
  finderOutcome,
  FOUND_CODES,
  MIN_LINK_SCORE,
  pageLinks,
  sameSite,
  urlIdentity,
  type FinderKey,
  type FinderResult,
  type FoundDocument,
  type SearchContext,
  type TrailEntry,
} from "./finders";
import { createPlatformLearner, type PlatformLearner } from "./platform-learning";
import { runSecondDocumentFind, type RunSecondDocumentFindResult } from "./second-document";
import { countAnchors, detectPlatform, looksJavaScriptBuilt } from "./site-signals";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

export const MAGELLAN_DISCOVERY_DEFAULT_LIMIT = 25;
export const MAGELLAN_DISCOVERY_MAX_LIMIT = 50;
export const MAGELLAN_DISCOVERY_MIN_CONFIDENCE = MIN_LINK_SCORE;

const DISCOVERY_METHOD = "magellan_agentic_discovery";
/**
 * The find team's method version, stored on every attempt (`detail.method_version`).
 * Bump it whenever a specialist is added or changed: every bank whose last search used
 * an older method is searched again at once, whatever its backoff.
 * 1: homepage links and guessed paths. 2: the find team (known link, homepage links,
 * site maps, hub pages, platform paths, guessed paths; peer hint and bounded crawl).
 */
export const DISCOVERY_METHOD_VERSION = 2;
/** One bank never takes longer than this. */
const INSTITUTION_BUDGET_MS = 45_000;
// The tick starts no step after 180 s of its 300 s limit, so a step must end within ~110 s:
// no bank starts after STEP_START_BUDGET_MS and none runs past STEP_HARD_BUDGET_MS.
const STEP_START_BUDGET_MS = 75_000;
const STEP_HARD_BUDGET_MS = 100_000;
/** Pause between crawl requests to one site. */
const DEFAULT_POLITE_DELAY_MS = 250;
const MAX_TRAIL = 60;
/** Searches cut short by time before a bank is treated as a miss rather than retried in 12 hours. */
const OUT_OF_TIME_RETRIES = 2;

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
  profile_consecutive_failures?: number | string | null;
}

export type DiscoveryOutcome = "discovered" | "dead" | "needs_human" | "retry_after" | "failure";

/** Where discovery stopped for a bank, in one word (logged on every attempt). */
export type DiscoveryCode =
  | "locked"
  | "no_website"
  | "unreachable"
  | "blocked"
  | (typeof FOUND_CODES)[FinderKey]
  | "found_paid_search"
  | "js_homepage"
  | "no_fee_links"
  | "candidates_failed"
  | "out_of_time";

/** One specialist's part of a bank's search. */
export interface FinderRunSummary {
  key: FinderKey;
  strategy: string;
  version: number;
  pass: 1 | 2;
  outcome: AttemptOutcome;
  fetches: number;
  durationMs: number;
  note?: string;
  trail: TrailEntry[];
}

export interface CandidateDiscoveryResult {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  outcome: DiscoveryOutcome;
  code: DiscoveryCode;
  url: string | null;
  documentType: string | null;
  confidence: number | null;
  reason: string;
  method: string;
  attemptedUrls: number;
  /** The specialist that found the link, when one did. */
  foundBy: FinderKey | null;
  /** The homepage after redirects, when it moved to another domain. */
  movedTo: string | null;
  platform: string | null;
  /** sha256 of the homepage HTML: the input fingerprint of this search. */
  homepageHash: string | null;
  finders: FinderRunSummary[];
  durationMs: number;
}

export interface RunMagellanDiscoveryOptions {
  runId: number;
  stepId?: number;
  mode?: "discover" | "rescue";
  limit?: number;
  dryRun?: boolean;
  stateCode?: string;
  db?: SqlTag;
  fetchImpl?: Fetcher;
  /** Pause between crawl requests (tests pass 0). */
  politeDelayMs?: number;
  /** Look for second documents of thin banks after the main search (default true in `discover` mode). */
  secondDocuments?: boolean;
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
  /** Counts by discovery code: where each bank stopped. */
  codes: Partial<Record<DiscoveryCode, number>>;
  /** Finds per specialist. */
  foundBy: Partial<Record<FinderKey, number>>;
  learning: boolean;
  methodVersion: number;
  secondDocuments: RunSecondDocumentFindResult | null;
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

async function loadRejectedUrls(db: SqlTag, institutionIds: number[]): Promise<Map<number, Set<string>>> {
  const byInstitution = new Map<number, Set<string>>();
  if (institutionIds.length === 0) return byInstitution;
  const rows = await db`
    SELECT institution_id, rejected_source_urls
      FROM institution_source_profiles
     WHERE institution_id = ANY(${institutionIds})
       AND jsonb_array_length(rejected_source_urls) > 0
  `;
  for (const row of rows) {
    const entries = Array.isArray(row.rejected_source_urls) ? row.rejected_source_urls : [];
    const urls = new Set<string>();
    for (const entry of entries as Array<{ url?: unknown }>) {
      if (typeof entry?.url === "string") urls.add(urlIdentity(entry.url));
    }
    byInstitution.set(Number(row.institution_id), urls);
  }
  return byInstitution;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function blockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

const NO_KNOWLEDGE: PlatformLearner = {
  platformPaths: async () => [],
  peerPaths: async () => [],
  recordFind: async () => undefined,
};

/** One bank's search: the specialists in order, stopping at the first validated hit. */
async function discoverForInstitution(
  row: DiscoveryCandidateRow,
  options: {
    fetchImpl: Fetcher;
    rejectedUrls?: Set<string>;
    knowledge: PlatformLearner;
    deadline: number;
    politeDelayMs: number;
  },
): Promise<CandidateDiscoveryResult> {
  const startedAt = Date.now();
  const institutionId = Number(row.id);
  const institutionName = String(row.institution_name);
  const stateCode = normalizeStateCode(row.state_code);
  const finders: FinderRunSummary[] = [];
  let attemptedUrls = 0;
  let movedTo: string | null = null;
  let platform: string | null = null;
  let homepageHash: string | null = null;
  const finish = (
    fields: Pick<CandidateDiscoveryResult, "outcome" | "code" | "reason"> &
      Partial<Pick<CandidateDiscoveryResult, "url" | "documentType" | "confidence" | "foundBy">>,
  ): CandidateDiscoveryResult => ({
    institutionId,
    institutionName,
    stateCode,
    url: null,
    documentType: null,
    confidence: null,
    foundBy: null,
    method: DISCOVERY_METHOD,
    attemptedUrls,
    movedTo,
    platform,
    homepageHash,
    finders,
    durationMs: Date.now() - startedAt,
    ...fields,
  });

  const correctedUrl = lockedByCorrection(row) ? normalizeHttpUrl(row.profile_canonical_source_url) : null;
  if (correctedUrl) {
    return finish({
      outcome: "discovered",
      code: "locked",
      url: correctedUrl,
      documentType: profileDocumentType(row),
      confidence: 1,
      reason: "Locked source correction supplied canonical source URL",
    });
  }

  const baseUrl = normalizeWebsiteUrl(row.website_url);
  if (!baseUrl) {
    return finish({ outcome: "needs_human", code: "no_website", reason: "Invalid or missing website_url" });
  }

  // The homepage is read once and shared by every specialist; its request is logged on
  // the homepage-links attempt.
  const homepageTrail: TrailEntry = { url: baseUrl.toString(), source: "homepage", foundOn: null, label: "", score: 0, verdict: "" };
  const homepageStarted = Date.now();
  const homepageFailure = (outcome: AttemptOutcome) =>
    finders.push({
      key: "homepageLinks",
      ...FINDERS.homepageLinks,
      outcome,
      fetches: 1,
      durationMs: Date.now() - homepageStarted,
      trail: [homepageTrail],
    });
  let homepage: Response;
  attemptedUrls += 1;
  try {
    homepage = await fetchWithTimeout(options.fetchImpl, baseUrl.toString());
  } catch (error) {
    homepageTrail.verdict = "fetch_failed";
    const message = error instanceof Error ? error.message : String(error);
    homepageFailure(/abort|timed? ?out/i.test(message) ? "timeout" : "network_error");
    return finish({ outcome: "retry_after", code: "unreachable", reason: `Homepage fetch failed: ${message}` });
  }
  homepageTrail.verdict = `http_${homepage.status}`;
  if (!homepage.ok) {
    const blocked = blockedStatus(homepage.status);
    homepageFailure(homepage.status === 429 ? "http_429" : blocked ? "http_403" : homepage.status >= 500 ? "http_5xx" : homepage.status === 404 ? "http_404" : "http_other");
    // A bot wall is a miss (re-checked on the monthly schedule); anything else is transient.
    return finish({
      outcome: blocked ? "dead" : "retry_after",
      code: blocked ? "blocked" : "unreachable",
      reason: `Homepage HTTP ${homepage.status}`,
    });
  }

  // A redirect to another domain (rebrand, merger): search the site it lands on.
  let site = baseUrl;
  try {
    const landed = homepage.url ? new URL(homepage.url) : null;
    if (landed && !sameSite(landed, baseUrl)) {
      movedTo = landed.origin;
      site = new URL(landed.origin);
    }
  } catch {
    // keep the original site
  }

  const html = await homepage.text();
  homepageHash = sha256Text(html);
  platform = detectPlatform(html);
  const ctx: SearchContext = {
    institutionId,
    stateCode,
    site,
    fetchImpl: options.fetchImpl,
    rejected: options.rejectedUrls ?? new Set(),
    tried: new Set([urlIdentity(site.toString())]),
    homepageHtml: html,
    homepageLinks: pageLinks(html, site),
    platform,
    knownUrl: normalizeHttpUrl(row.profile_canonical_source_url),
    deadline: options.deadline,
    politeDelayMs: options.politeDelayMs,
    knowledge: options.knowledge,
    pages: new Map([[urlIdentity(site.toString()), html]]),
  };

  let lastReason = "No candidate validated";
  let ranOutOfTime = false;
  for (const { key, run } of FINDER_ORDER) {
    if (Date.now() > options.deadline) {
      ranOutOfTime = true;
      break;
    }
    const finderStarted = Date.now();
    let result: FinderResult;
    try {
      result = await run(ctx);
    } catch (error) {
      result = { found: null, trail: [], fetches: 0, ran: true, outOfTime: false, note: `error: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (key === "homepageLinks") {
      result = { ...result, trail: [homepageTrail, ...result.trail], fetches: result.fetches + 1 };
    }
    attemptedUrls += result.fetches - (key === "homepageLinks" ? 1 : 0);
    if (!result.ran) continue;
    finders.push({
      key,
      ...FINDERS[key],
      outcome: finderOutcome(result),
      fetches: result.fetches,
      durationMs: Date.now() - finderStarted,
      note: result.note,
      trail: result.trail.slice(0, MAX_TRAIL),
    });
    const lastVerdict = [...result.trail].reverse().find((entry) => entry.verdict && !["robots", "sitemap_file", "homepage"].includes(entry.source));
    if (lastVerdict) lastReason = `${FINDERS[key].strategy}: ${lastVerdict.url} ${lastVerdict.verdict}`;
    if (result.found) return foundResult(finish, key, result.found);
    if (result.outOfTime) {
      ranOutOfTime = true;
      break;
    }
  }

  if (ranOutOfTime) {
    // Cut short: search again in 12 hours, unless the site keeps running out of time.
    const failures = Number(row.profile_consecutive_failures ?? 0);
    return finish({
      outcome: failures >= OUT_OF_TIME_RETRIES ? "dead" : "retry_after",
      code: "out_of_time",
      reason: `Search stopped after ${Math.round((Date.now() - startedAt) / 1000)}s; ${lastReason}`,
    });
  }
  const sawCandidates = finders.some((finder) =>
    finder.trail.some((entry) => !["homepage", "robots", "sitemap_file", "hub_page", "crawl_page"].includes(entry.source)),
  );
  if (!sawCandidates && looksJavaScriptBuilt(html) && countAnchors(html) < 5) {
    return finish({ outcome: "dead", code: "js_homepage", reason: "Homepage is built by JavaScript; no links to follow without a browser" });
  }
  return finish({
    outcome: "dead",
    code: sawCandidates ? "candidates_failed" : "no_fee_links",
    reason: sawCandidates ? lastReason : "No fee-like links on the homepage, site map, hub pages or crawl",
  });
}

function foundResult(
  finish: (fields: Pick<CandidateDiscoveryResult, "outcome" | "code" | "reason"> & Partial<CandidateDiscoveryResult>) => CandidateDiscoveryResult,
  key: FinderKey,
  found: FoundDocument,
): CandidateDiscoveryResult {
  return finish({
    outcome: "discovered",
    code: FOUND_CODES[key],
    url: found.url,
    documentType: found.documentType,
    confidence: found.confidence,
    reason: found.reason,
    foundBy: key,
  });
}

/**
 * Banks due for a search. Nothing is dead forever:
 * - never searched, or pending/`retry_after` older than 12 hours;
 * - a miss (`dead`, `needs_human`) after a month, then after a quarter once it has
 *   missed twice in a row (`consecutive_failures` on the bank's profile);
 * - any miss at once when its last search used an older discovery method version.
 */
async function selectCandidates(
  db: SqlTag,
  limit: number,
  stateCode: string | undefined,
  learning: boolean,
): Promise<DiscoveryCandidateRow[]> {
  const normalizedState = normalizeStateCode(stateCode);
  const currentMethod = JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION });
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
           profile.locked_by_correction AS profile_locked_by_correction,
           profile.consecutive_failures AS profile_consecutive_failures
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
       AND inst.website_url IS NOT NULL
       AND btrim(inst.website_url) <> ''
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND (
         profile.locked_by_correction IS TRUE
         OR inst.last_rescue_attempt_at IS NULL
         OR (
           COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')
           AND inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
         )
         OR (
           inst.rescue_status IN ('dead', 'needs_human')
           AND (
             inst.last_rescue_attempt_at < NOW() - CASE
               WHEN COALESCE(profile.consecutive_failures, 0) >= 2 THEN INTERVAL '90 days'
               ELSE INTERVAL '30 days'
             END
             OR (
               ${learning}::boolean
               AND inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_attempts pa
                  WHERE pa.institution_id = inst.id
                    AND pa.stage = 'discover'
                    AND pa.detail @> ${currentMethod}::jsonb
               )
             )
           )
         )
       )
     ORDER BY
       CASE WHEN profile.locked_by_correction IS TRUE AND profile.canonical_source_url IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.last_rescue_attempt_at IS NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.rescue_status = 'retry_after' THEN 1 ELSE 0 END,
       inst.last_rescue_attempt_at NULLS FIRST,
       inst.asset_size DESC NULLS LAST,
       inst.id ASC
     LIMIT ${limit}
  `;
}

/** Writes a bank's search result: its fee link (or miss), discovery evidence and profile. */
export async function recordDiscoveryResult(
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
  const failureNote = result.outcome === "discovered" ? null : `${result.code}: ${result.reason}`;

  await db`
    UPDATE institution_sources
       SET fee_schedule_url = COALESCE(${result.url}, fee_schedule_url),
           document_type = COALESCE(${result.documentType}, document_type),
           website_url = COALESCE(${result.movedTo}, website_url),
           cms_platform = COALESCE(cms_platform, ${result.platform}),
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
      platform,
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
      ${result.platform},
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
      platform = COALESCE(EXCLUDED.platform, institution_source_profiles.platform),
      updated_at = NOW()
  `;
}

/** One `pipeline_attempts` row per specialist that ran (stage `discover`). */
async function recordFinderAttempts(
  db: SqlTag,
  row: DiscoveryCandidateRow,
  result: CandidateDiscoveryResult,
  options: { runId: number; stepId: number | null },
): Promise<void> {
  const base = {
    method_version: DISCOVERY_METHOD_VERSION,
    website: row.website_url,
    moved_to: result.movedTo,
    platform: result.platform,
  };
  if (result.finders.length === 0) {
    // Locked correction or no website: one attempt for the search as a whole.
    await recordAttempt(db, {
      institutionId: result.institutionId,
      stage: "discover",
      strategy: result.code === "locked" ? FINDERS.knownLink.strategy : FINDERS.homepageLinks.strategy,
      version: result.code === "locked" ? FINDERS.knownLink.version : FINDERS.homepageLinks.version,
      fingerprint: result.homepageHash,
      outcome: result.code === "locked" ? "ok" : "invalid_url",
      yieldCount: result.url ? 1 : 0,
      costMicrousd: 0,
      durationMs: result.durationMs,
      runId: options.runId,
      stepId: options.stepId,
      detail: { ...base, pass: 1, code: result.code, url: result.url, reason: result.reason },
    });
    return;
  }
  const last = result.finders.length - 1;
  for (const [index, finder] of result.finders.entries()) {
    const found = index === last && result.outcome === "discovered";
    await recordAttempt(db, {
      institutionId: result.institutionId,
      stage: "discover",
      strategy: finder.strategy,
      version: finder.version,
      fingerprint: result.homepageHash,
      outcome: finder.outcome,
      yieldCount: found ? 1 : 0,
      costMicrousd: 0,
      durationMs: finder.durationMs,
      runId: options.runId,
      stepId: options.stepId,
      detail: {
        ...base,
        pass: finder.pass,
        // The search's end code goes on its last specialist only.
        code: index === last ? result.code : null,
        url: found ? result.url : null,
        document_type: found ? result.documentType : null,
        confidence: found ? result.confidence : null,
        reason: index === last ? result.reason : null,
        note: finder.note ?? null,
        pages_fetched: finder.fetches,
        trail: finder.trail,
      },
    });
  }
}

export async function runMagellanDiscovery(
  options: RunMagellanDiscoveryOptions,
): Promise<RunMagellanDiscoveryResult> {
  const db = options.db ?? sql;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const politeDelayMs = options.politeDelayMs ?? DEFAULT_POLITE_DELAY_MS;
  const learning = !dryRun && (await learningSchemaReady(db));
  const rows = await selectCandidates(db, limit, options.stateCode, learning);
  const rejected = !dryRun && rows.length > 0 && (await documentVaultSchemaReady(db))
    ? await loadRejectedUrls(db, rows.map((row) => Number(row.id)))
    : new Map<number, Set<string>>();
  const knowledge = dryRun ? NO_KNOWLEDGE : createPlatformLearner(db);

  const startedAt = Date.now();
  const stepDeadline = startedAt + STEP_HARD_BUDGET_MS;
  const results: CandidateDiscoveryResult[] = [];
  for (const row of rows) {
    // Banks not reached this step stay due and are picked up by the next one.
    if (Date.now() - startedAt > STEP_START_BUDGET_MS) break;
    const institutionId = Number(row.id);
    const result = await discoverForInstitution(row, {
      fetchImpl,
      rejectedUrls: rejected.get(institutionId),
      knowledge,
      deadline: Math.min(Date.now() + INSTITUTION_BUDGET_MS, stepDeadline),
      politeDelayMs,
    });
    results.push(result);
    if (dryRun) continue;
    await recordDiscoveryResult(db, result);
    if (learning) await recordFinderAttempts(db, row, result, { runId: options.runId, stepId: options.stepId ?? null });
    if (result.outcome === "discovered" && result.url && result.code !== "locked") {
      await knowledge.recordFind({ platform: result.platform, url: result.url, foundByPlatformPath: result.foundBy === "platformPaths" || result.foundBy === "peerHint" });
    }
  }

  const wantSecondDocuments = options.secondDocuments ?? options.mode !== "rescue";
  const secondDocuments = wantSecondDocuments && Date.now() - startedAt < STEP_START_BUDGET_MS
    ? await runSecondDocumentFind({
        db,
        fetchImpl,
        runId: options.runId,
        stepId: options.stepId ?? null,
        stateCode: options.stateCode ?? null,
        deadline: stepDeadline,
        dryRun,
        learning,
      })
    : null;

  const codes: Partial<Record<DiscoveryCode, number>> = {};
  const foundBy: Partial<Record<FinderKey, number>> = {};
  for (const result of results) {
    codes[result.code] = (codes[result.code] ?? 0) + 1;
    if (result.foundBy) foundBy[result.foundBy] = (foundBy[result.foundBy] ?? 0) + 1;
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
    codes,
    foundBy,
    learning,
    methodVersion: DISCOVERY_METHOD_VERSION,
    secondDocuments,
    limit,
    dryRun,
    results,
  };
}
