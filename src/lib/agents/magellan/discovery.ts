import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { loadMarketLeaderIds } from "@/lib/data-store/market-leaders";
import {
  normalizeStateCode,
  readStrategyFromDocumentType,
  sourceKindFromDocumentType,
} from "@/lib/agents/state-lane-memory";
import { documentVaultSchemaReady } from "@/lib/agents/document-vault";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { orderByHints, stateExpertHints, type StateExpertHints } from "@/lib/agents/state-expert/memory";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { fetchWithTimeout } from "./find-validate";
import {
  FINDER_ORDER,
  FINDERS,
  findFromRejectedPages,
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
import { LINK_YIELD_CHECK, LINK_YIELD_SLOTS, stepSlot } from "./outcomes";
import { loadPageClassifier, type PageClassifier } from "./page-classifier";
import { createPlatformLearner, type PlatformLearner } from "./platform-learning";
import {
  ARTICLE_LINK_SQL,
  BUSINESS_PATH_SQL,
  CONSUMER_PATH_SQL,
  FEE_DOCUMENT_NAME_SQL,
  FEE_NAMED_LINK_SQL,
  FEE_SCHEDULE_NAME_SQL,
  isArticleLink,
  isSingleProductDisclosureLink,
  PRODUCT_DISCLOSURE_SQL,
  PRODUCT_LINK_SQL,
  SINGLE_PRODUCT_SQL,
} from "./link-coverage";
import { loadDemotedFinders } from "./batch-review";
import { keepRefusedPaidAnswers, type KeepRefusedAnswersResult } from "./refused-answers";
import { restoreSwappedFeePages, type RestoreFeePagesResult } from "./restore-fee-page";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordSearchMisses } from "./search-misses";
import { runSecondDocumentFind, type RunSecondDocumentFindResult } from "./second-document";
import { countAnchors, detectPlatform, looksJavaScriptBuilt, looksLikeBotChallenge } from "./site-signals";
import { repairIsWorthSaving, repairWebsiteUrl } from "./website-repair";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

// A step stops starting banks at STEP_START_BUDGET_MS, so the limit is a ceiling, not the
// pace: at 25 a step often finished early and left free search time unused.
export const MAGELLAN_DISCOVERY_DEFAULT_LIMIT = 50;
export const MAGELLAN_DISCOVERY_MAX_LIMIT = 50;
export const MAGELLAN_DISCOVERY_MIN_CONFIDENCE = MIN_LINK_SCORE;

const DISCOVERY_METHOD = "magellan_agentic_discovery";
/**
 * The find team's method version, stored on every attempt (`detail.method_version`).
 * Bump it whenever a specialist is added or changed: every bank whose last search used
 * an older method is searched again at once, whatever its backoff.
 * 1: homepage links and guessed paths. 2: the find team (known link, homepage links,
 * site maps, hub pages, platform paths, guessed paths; peer hint and bounded crawl).
 * 3: links on pages Rosetta ruled out are followed first (even when the homepage
 * blocks bots), "fee sheet" is a strong link phrase, and rejections expire.
 * 4: a homepage that blocks bots (HTTP 401/403 or a challenge page) no longer ends the
 * search: the known link and the site map (robots.txt rules respected) still run; the
 * stored website is repaired first ("wwwbank.com", "www.bankcom").
 * 5: one product's disclosure is never the schedule, finders that fail two error reviews
 * in a row run last, and links to another country's schedule are refused (7 Oct 2026).
 */
export const DISCOVERY_METHOD_VERSION = 5;
/** The website repair, logged as its own attempt when it changes the stored address. */
export const WEBSITE_REPAIR_STRATEGY = { strategy: "discover.website_repair", version: 1 } as const;
/**
 * Specialists that need no homepage: run when the homepage blocks bots. Nothing here
 * tries to get past the wall; it reads what the site publishes for crawlers.
 */
const BLOCKED_HOMEPAGE_FINDERS = new Set<FinderKey>(["knownLink", "sitemap"]);
/**
 * Banks whose fee link is an account or product page get one search for the real fee
 * schedule per version (`detail.upgrade_search`), in spare discovery capacity. Bump it
 * to search those banks again after a finder change.
 */
// v2 (Oct 7): the finders learned big-bank names ("Schedule of Charges", "Consumer Fees").
export const UPGRADE_SEARCH_VERSION = 2;
/**
 * Banks whose fee link is a business-only schedule (link-coverage.ts) get one search for the
 * consumer schedule per version (`detail.business_search`), before the product-page
 * upgrades. Their link is kept until a consumer schedule is found; then it stays as a
 * business companion.
 */
export const BUSINESS_SEARCH_VERSION = 1;
/**
 * Discovery slots kept for business-only links even when banks without a link fill the
 * step. A business link publishes business prices as the bank's consumer fees, which is
 * worse than no link, and spare capacity alone reached 41 of 187 such banks (7 Oct 2026).
 */
export const BUSINESS_RESERVED_SLOTS = 3;
/**
 * Slots kept for product-page links and for out-of-date links. In spare capacity alone a
 * state with many banks without a link never reached them: on 7 Oct 2026 1,208 of 5,232
 * links (23%) were product pages, 129 searched at this version, and 260 links named 2023
 * or earlier, 18 searched.
 */
export const UPGRADE_RESERVED_SLOTS = 3;
export const FRESHNESS_RESERVED_SLOTS = 2;
/**
 * Banks whose fee link looks out of date get one search for a newer schedule per version
 * (`detail.freshness_search`), in spare discovery capacity, after the upgrade searches.
 * A link is stale when the schedule's own "Effective ..." date, or (without one) a year
 * in its address, is STALE_AFTER_YEARS or more years before this year.
 */
export const FRESHNESS_SEARCH_VERSION = 1;
export const STALE_AFTER_YEARS = 3;
/** "Effective January 1, 2022", "Effective Date: 01/01/2022" in a schedule's opening text. */
const EFFECTIVE_YEAR_SQL = "(?i)effective(?:\\s+date)?[:\\s]+(?:[a-z]+\\.?\\s+\\d{1,2},?\\s+|\\d{1,2}/\\d{1,2}/)(20\\d{2})";
/** A year in the link's address ("/2022-fee-schedule.pdf", "/uploads/2021/05/"). */
const URL_YEAR_SQL = "(?:^|[^0-9])(20[0-2][0-9])(?:[^0-9]|$)";
/** One bank never takes longer than this. */
const INSTITUTION_BUDGET_MS = 45_000;
// The tick starts no step after 180 s of its 300 s limit, so a step must end within ~110 s:
// no bank starts after STEP_START_BUDGET_MS and none runs past STEP_HARD_BUDGET_MS.
const STEP_START_BUDGET_MS = 75_000;
const STEP_HARD_BUDGET_MS = 100_000;
/** Pause between crawl requests to one site. */
const DEFAULT_POLITE_DELAY_MS = 250;
const MAX_TRAIL = 60;
/**
 * Without the attempt log (no resume state), searches cut short by time before a bank is
 * treated as a miss rather than retried in 12 hours.
 */
const OUT_OF_TIME_RETRIES = 2;
/**
 * A search cut short by time resumes at the next specialist (`DiscoveryResume`). The clock
 * stopping in the same specialist this many times on a full per-bank budget skips it.
 */
export const RESUME_MAX_CUTS_PER_FINDER = 2;
/** Cut-off searches a bank may chain before it is a miss (re-checked on the monthly schedule). */
export const RESUME_MAX_TICKS = 12;
/** Cut-off banks put at the front of a step, each with the full per-bank budget. */
export const RESUME_FIRST_PER_STEP = 1;

/** Every specialist key, in the order a search runs them. */
const SEARCH_ORDER: FinderKey[] = ["rejectedPageLinks", ...FINDER_ORDER.map((finder) => finder.key)];

/**
 * Where a search cut short by time stopped, so the next search continues there instead of
 * starting over. Stored on the last `pipeline_attempts` row of the search
 * (`detail.resume`; null once a search ends) and read back when the bank is selected.
 */
export interface DiscoveryResume {
  /** The `DISCOVERY_METHOD_VERSION` it was written under; another version starts over. */
  methodVersion: number;
  /** Specialists that finished without a find (or were skipped) on earlier searches. */
  done: FinderKey[];
  /** The specialist the clock stopped inside, if it stopped inside one. */
  cutIn: FinderKey | null;
  /** Times in a row the clock stopped inside `cutIn` on a full per-bank budget. */
  cutCount: number;
  /** Cut-off searches so far in this chain. */
  ticks: number;
  /** Specialists skipped after being cut off `RESUME_MAX_CUTS_PER_FINDER` times. */
  skipped: FinderKey[];
  /** An earlier search in the chain saw fee-like candidates (for the final miss code). */
  sawCandidates: boolean;
}

function isFinderKey(value: unknown): value is FinderKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FINDERS, value);
}

/** The resume state from `detail.resume`, or null when absent, malformed or from another method version. */
export function parseDiscoveryResume(value: unknown): DiscoveryResume | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (Number(record.methodVersion) !== DISCOVERY_METHOD_VERSION) return null;
  const keys = (list: unknown) => (Array.isArray(list) ? [...new Set(list.filter(isFinderKey))] : []);
  return {
    methodVersion: DISCOVERY_METHOD_VERSION,
    done: keys(record.done),
    cutIn: isFinderKey(record.cutIn) ? record.cutIn : null,
    cutCount: Math.max(0, Math.floor(Number(record.cutCount) || 0)),
    ticks: Math.max(0, Math.floor(Number(record.ticks) || 0)),
    skipped: keys(record.skipped),
    sawCandidates: record.sawCandidates === true,
  };
}

/**
 * Pure: the resume state after a search cut short by time.
 * - `completed`: specialists that finished (or had nothing to do) on this search.
 * - `cutIn`: the specialist the clock stopped inside, or null when it stopped between two.
 * - `fullBudget`: the bank had the whole per-bank budget; only then does a cut count
 *   toward skipping that specialist (a bank squeezed in at the end of a step is not).
 */
export function nextDiscoveryResume(
  previous: DiscoveryResume | null,
  search: { completed: FinderKey[]; cutIn: FinderKey | null; fullBudget: boolean; sawCandidates: boolean },
): DiscoveryResume {
  const done = new Set<FinderKey>([...(previous?.done ?? []), ...search.completed]);
  const skipped = new Set<FinderKey>(previous?.skipped ?? []);
  let cutIn = search.cutIn;
  let cutCount = 0;
  if (cutIn) {
    const before = previous?.cutIn === cutIn ? previous.cutCount : 0;
    cutCount = before + (search.fullBudget ? 1 : 0);
    if (cutCount >= RESUME_MAX_CUTS_PER_FINDER) {
      done.add(cutIn);
      skipped.add(cutIn);
      cutIn = null;
      cutCount = 0;
    }
  }
  return {
    methodVersion: DISCOVERY_METHOD_VERSION,
    done: SEARCH_ORDER.filter((key) => done.has(key)),
    cutIn,
    cutCount,
    ticks: (previous?.ticks ?? 0) + 1,
    skipped: SEARCH_ORDER.filter((key) => skipped.has(key)),
    sawCandidates: Boolean(previous?.sawCandidates) || search.sawCandidates,
  };
}

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
  /** The bank's current fee link (upgrade searches only). */
  fee_schedule_url?: string | null;
  /** True when the bank has a product-page link and this is a search for the real schedule. */
  upgrade?: boolean;
  /** True when the bank's link is a business-only schedule and this searches for the consumer one. */
  business?: boolean;
  /** True when the bank's link looks out of date and this is a search for a newer one. */
  freshness?: boolean;
  /** Why the link looks out of date ("effective 2021", "address names 2022"). */
  stale_reason?: string | null;
  /** `detail.resume` of the bank's last search, when it was cut short by time. */
  discovery_resume?: unknown;
  /** True when the bank's last search was cut short by time (`retry_after`, `out_of_time`). */
  discovery_cut_off?: boolean | string | null;
}

export type DiscoveryOutcome = "discovered" | "dead" | "needs_human" | "retry_after" | "failure";

/** Where discovery stopped for a bank, in one word (logged on every attempt). */
export type DiscoveryCode =
  | "locked"
  | "no_website"
  | "website_unrepairable"
  | "unreachable"
  | "blocked"
  | (typeof FOUND_CODES)[FinderKey]
  /** Found by the site map or known link although the homepage blocked bots. */
  | "found_blocked_homepage"
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
  /** The homepage refused us (HTTP 401/403 or a bot challenge page). */
  homepageBlocked: boolean;
  /** The stored website as repaired before the search, when it needed repair. */
  websiteRepair: WebsiteRepairSummary | null;
  finders: FinderRunSummary[];
  durationMs: number;
  /** The search continued from an earlier cut-off search (the state it started from). */
  resumedFrom: DiscoveryResume | null;
  /** Where the next search continues; null unless this search was cut short by time with resume on. */
  resume: DiscoveryResume | null;
}

export interface WebsiteRepairSummary {
  original: string | null;
  /** The repaired address; null when it could not be read at all. */
  repaired: string | null;
  changes: string[];
  warnings: string[];
  reason: string | null;
  /** True when the repaired address is written to `institution_sources.website_url`. */
  save: boolean;
  /** A person's correction locks this bank's source: the repair is used but never saved. */
  locked: boolean;
}

export interface RunMagellanDiscoveryOptions {
  runId: number;
  stepId?: number;
  mode?: "discover" | "rescue";
  limit?: number;
  /**
   * Slots kept for product-page links searched for the real schedule (default
   * UPGRADE_RESERVED_SLOTS). A direct state re-search raises it so thin links are not
   * left behind dead banks.
   */
  upgradeSlots?: number;
  dryRun?: boolean;
  stateCode?: string;
  db?: SqlTag;
  fetchImpl?: Fetcher;
  /** The state's market leader ids, searched first; loaded from the shared ranking when left out. */
  leaderIds?: number[];
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
  /** Banks whose search continued from an earlier cut-off search instead of starting over. */
  resumed: number;
  /** Finds per specialist. */
  foundBy: Partial<Record<FinderKey, number>>;
  /** Banks whose stored website was repaired (and saved) before the search. */
  websitesRepaired: number;
  /** Banks found although their homepage blocked bots. */
  blockedHomepageRescues: number;
  learning: boolean;
  /** The shadow page classifier this step scored candidates with, if one is stored. */
  pageClassifier: { trainedAt: string | null; positives: number; negatives: number } | null;
  /** Specialist strategies in the order this step ran them, and whether the state expert set it. */
  finderOrder: { strategies: string[]; source: "state_expert" | "default"; demoted?: string[] };
  methodVersion: number;
  secondDocuments: RunSecondDocumentFindResult | null;
  /** Fee pages put back as the main link after a blank read had swapped them out. */
  restoredFeePages: RestoreFeePagesResult | null;
  /** Paid search answers kept although the bank's site refused our check (HTTP 403). */
  keptRefusedAnswers: KeepRefusedAnswersResult | null;
  /** Search-miss lessons written (`magellan.search_miss`). */
  searchMisses: number;
  limit: number;
  dryRun: boolean;
  results: CandidateDiscoveryResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAGELLAN_DISCOVERY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAGELLAN_DISCOVERY_MAX_LIMIT);
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

/**
 * A ruled-out URL is skipped for this long, then may be proposed again: banks rewrite
 * pages, and the fee-page check improves. The page's own links are followed at once.
 */
export const REJECTED_URL_TTL_DAYS = 90;

export interface RejectedSources {
  /** URL identities still inside their ban. */
  identities: Set<string>;
  /** Distinct ruled-out page URLs, newest first (bans expired or not). */
  pages: string[];
}

/** Distinct rejected URLs, newest first, and the identities still banned. */
export function rejectedSourcesFrom(entries: unknown, now = Date.now()): RejectedSources {
  const list = Array.isArray(entries) ? (entries as Array<{ url?: unknown; at?: unknown }>) : [];
  const identities = new Set<string>();
  const pages: string[] = [];
  const seen = new Set<string>();
  const cutoff = now - REJECTED_URL_TTL_DAYS * 86_400_000;
  for (const entry of [...list].reverse()) {
    if (typeof entry?.url !== "string") continue;
    const identity = urlIdentity(entry.url);
    const at = typeof entry.at === "string" ? Date.parse(entry.at) : Number.NaN;
    if (Number.isNaN(at) || at >= cutoff) identities.add(identity);
    if (!seen.has(identity)) {
      seen.add(identity);
      pages.push(entry.url);
    }
  }
  return { identities, pages };
}

async function loadRejectedUrls(db: SqlTag, institutionIds: number[]): Promise<Map<number, RejectedSources>> {
  const byInstitution = new Map<number, RejectedSources>();
  if (institutionIds.length === 0) return byInstitution;
  const rows = await db`
    SELECT institution_id, rejected_source_urls
      FROM institution_source_profiles
     WHERE institution_id = ANY(${institutionIds})
       AND jsonb_array_length(rejected_source_urls) > 0
  `;
  for (const row of rows) {
    byInstitution.set(Number(row.institution_id), rejectedSourcesFrom(row.rejected_source_urls));
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
    rejectedUrls?: RejectedSources;
    knowledge: PlatformLearner;
    deadline: number;
    politeDelayMs: number;
    /** Where an earlier cut-off search stopped; its finished specialists are not run again. */
    resume?: DiscoveryResume | null;
    /** Write a resume state when the search is cut short (needs the attempt log). */
    resumable?: boolean;
    /** The bank has the whole per-bank budget (not squeezed by the step's end). */
    fullBudget?: boolean;
    /** The learned fee-page classifier, in shadow (scores trail entries only). */
    pageClassifier?: PageClassifier | null;
    /** Specialist order for this bank's state (the state expert's ranking); default FINDER_ORDER. */
    finderOrder?: typeof FINDER_ORDER;
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
  const resumedFrom = options.resume ?? null;
  const alreadyDone = new Set<FinderKey>(resumedFrom?.done ?? []);
  let resume: DiscoveryResume | null = null;
  let homepageBlocked = false;
  let websiteRepair: WebsiteRepairSummary | null = null;
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
    homepageBlocked,
    websiteRepair,
    finders,
    durationMs: Date.now() - startedAt,
    resumedFrom,
    resume,
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

  // Repair obvious typos in the stored website before searching it. No other stored
  // website exists to fall back on: the FDIC registry step only fills an empty
  // website_url and the NCUA step stores none, so an unreadable one goes to a person.
  const repair = repairWebsiteUrl(row.website_url);
  if (repair.status === "empty") {
    return finish({ outcome: "needs_human", code: "no_website", reason: "Missing website_url" });
  }
  const locked = lockedByCorrection(row);
  if (repair.status === "unparseable" || repairIsWorthSaving(repair)) {
    websiteRepair = {
      original: repair.original,
      repaired: repair.url,
      changes: repair.changes,
      warnings: repair.warnings,
      reason: repair.reason ?? null,
      save: repair.status === "repaired" && !locked,
      locked,
    };
  }
  if (repair.status === "unparseable" || !repair.url) {
    return finish({
      outcome: "needs_human",
      code: "website_unrepairable",
      reason: `Website "${row.website_url}" cannot be read (${repair.reason ?? "unknown"}); no registry website is stored to fall back on`,
    });
  }
  const baseUrl = new URL(repair.url);

  const ctx: SearchContext = {
    institutionId,
    stateCode,
    site: baseUrl,
    fetchImpl: options.fetchImpl,
    rejected: options.rejectedUrls?.identities ?? new Set(),
    tried: new Set([urlIdentity(baseUrl.toString())]),
    homepageHtml: "",
    homepageLinks: [],
    platform: null,
    knownUrl: normalizeHttpUrl(row.profile_canonical_source_url),
    rejectedPages: options.rejectedUrls?.pages ?? [],
    deadline: options.deadline,
    politeDelayMs: options.politeDelayMs,
    knowledge: options.knowledge,
    pages: new Map(),
    pageClassifier: options.pageClassifier ?? null,
  };

  // Pages already ruled out often link to the real schedule: follow them first, before
  // (and regardless of) the homepage, which may block bots.
  // Specialists that finished this search (no find), and the one the clock stopped inside.
  const completed: FinderKey[] = [];
  let cutIn: FinderKey | null = null;
  if (ctx.rejectedPages && ctx.rejectedPages.length > 0 && !alreadyDone.has("rejectedPageLinks")) {
    const finderStarted = Date.now();
    const result = await findFromRejectedPages(ctx).catch((error): FinderResult => ({
      found: null, trail: [], fetches: 0, ran: true, outOfTime: false,
      note: `error: ${error instanceof Error ? error.message : String(error)}`,
    }));
    attemptedUrls += result.fetches;
    if (result.ran) {
      finders.push({
        key: "rejectedPageLinks",
        ...FINDERS.rejectedPageLinks,
        outcome: finderOutcome(result),
        fetches: result.fetches,
        durationMs: Date.now() - finderStarted,
        note: result.note,
        trail: result.trail.slice(0, MAX_TRAIL),
      });
    }
    if (result.found) return foundResult(finish, "rejectedPageLinks", result.found);
    if (result.outOfTime) cutIn = "rejectedPageLinks";
    else completed.push("rejectedPageLinks");
  } else if (!alreadyDone.has("rejectedPageLinks")) {
    // No ruled-out pages to follow: nothing left for this specialist.
    completed.push("rejectedPageLinks");
  }

  let lastReason = resumedFrom
    ? `Resumed after ${resumedFrom.done.length} finished specialists; no candidate validated`
    : "No candidate validated";
  /**
   * Runs specialists in order until one finds a validated link or time runs out. Skips
   * specialists a resumed search already finished and records which ones finish now.
   */
  const runFinders = async (
    order: typeof FINDER_ORDER,
    homepageRead: boolean,
  ): Promise<{ found: { key: FinderKey; document: FoundDocument } | null; ranOutOfTime: boolean; lastReason: string }> => {
    if (cutIn !== null) return { found: null, ranOutOfTime: true, lastReason };
    for (const { key, run } of order) {
      if (alreadyDone.has(key)) continue;
      if (Date.now() > options.deadline) return { found: null, ranOutOfTime: true, lastReason };
      const finderStarted = Date.now();
      let result: FinderResult;
      try {
        result = await run(ctx);
      } catch (error) {
        result = { found: null, trail: [], fetches: 0, ran: true, outOfTime: false, note: `error: ${error instanceof Error ? error.message : String(error)}` };
      }
      const logsHomepage = homepageRead && key === "homepageLinks";
      if (logsHomepage) {
        result = { ...result, trail: [homepageTrail, ...result.trail], fetches: result.fetches + 1 };
      }
      attemptedUrls += result.fetches - (logsHomepage ? 1 : 0);
      if (!result.ran) {
        completed.push(key);
        continue;
      }
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
      if (result.found) return { found: { key, document: result.found }, ranOutOfTime: false, lastReason };
      if (result.outOfTime) {
        cutIn = key;
        return { found: null, ranOutOfTime: true, lastReason };
      }
      completed.push(key);
    }
    return { found: null, ranOutOfTime: false, lastReason };
  };
  const sawCandidatesNow = () =>
    finders.some((finder) =>
      finder.trail.some((entry) => !["homepage", "robots", "sitemap_file", "hub_page", "crawl_page", "rejected_page"].includes(entry.source)),
    );
  const outOfTimeResult = (reason: string) => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    if (options.resumable) {
      // Cut short: the next search (12 hours on) continues at the next specialist, so a
      // slow site is searched across several steps instead of restarting each time.
      const next = nextDiscoveryResume(resumedFrom, {
        completed,
        cutIn,
        fullBudget: options.fullBudget ?? true,
        sawCandidates: sawCandidatesNow(),
      });
      resume = next;
      const remaining = SEARCH_ORDER.filter((key) => !next.done.includes(key));
      return finish({
        outcome: next.ticks > RESUME_MAX_TICKS ? "dead" : "retry_after",
        code: "out_of_time",
        reason: `Search stopped after ${seconds}s (cut-off search ${next.ticks}, ${next.done.length} specialists done, next ${remaining[0] ?? "none"}); ${reason}`,
      });
    }
    // No attempt log to resume from: search again in 12 hours, unless the site keeps running out of time.
    const failures = Number(row.profile_consecutive_failures ?? 0);
    return finish({
      outcome: failures >= OUT_OF_TIME_RETRIES ? "dead" : "retry_after",
      code: "out_of_time",
      reason: `Search stopped after ${seconds}s; ${reason}`,
    });
  };
  /**
   * The homepage refused us. Its links are out of reach, but the bank's previous link
   * and its site map (named in robots.txt, else /sitemap.xml or /sitemap_index.xml) often
   * are not; every request follows robots.txt and keeps our crawler's own name.
   */
  const searchPastBlockedHomepage = async (why: string): Promise<CandidateDiscoveryResult> => {
    homepageBlocked = true;
    const blocked = await runFinders(FINDER_ORDER.filter(({ key }) => BLOCKED_HOMEPAGE_FINDERS.has(key)), false);
    if (blocked.found) {
      return finish({
        ...foundResult(finish, blocked.found.key, blocked.found.document),
        code: "found_blocked_homepage",
        reason: `${blocked.found.document.reason} (homepage ${why}; found by ${FINDERS[blocked.found.key].strategy})`,
      });
    }
    if (blocked.ranOutOfTime) return outOfTimeResult(`homepage ${why}; ${blocked.lastReason}`);
    // A bot wall is a miss (re-checked on the monthly schedule).
    return finish({ outcome: "dead", code: "blocked", reason: `Homepage ${why}; site map and known link found nothing (${blocked.lastReason})` });
  };

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
    // A 401/403 bot wall: try what the site publishes for crawlers. A 429 asks us to slow
    // down, so nothing more is requested from that site this time.
    if (homepage.status === 401 || homepage.status === 403) {
      await homepage.body?.cancel().catch(() => undefined);
      return searchPastBlockedHomepage(`HTTP ${homepage.status}`);
    }
    // A rate limit is a miss (re-checked on the monthly schedule); anything else is transient.
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
  if (looksLikeBotChallenge(html)) {
    homepageTrail.verdict = "bot_challenge";
    homepageFailure("blocked_bot");
    return searchPastBlockedHomepage("served a bot challenge page");
  }
  homepageHash = sha256Text(html);
  platform = detectPlatform(html);
  ctx.site = site;
  ctx.tried.add(urlIdentity(site.toString()));
  ctx.homepageHtml = html;
  ctx.homepageLinks = pageLinks(html, site);
  ctx.platform = platform;
  ctx.pages.set(urlIdentity(site.toString()), html);

  const search = await runFinders(options.finderOrder ?? FINDER_ORDER, true);
  if (search.found) return foundResult(finish, search.found.key, search.found.document);
  if (search.ranOutOfTime) return outOfTimeResult(search.lastReason);
  const sawCandidates = sawCandidatesNow() || Boolean(resumedFrom?.sawCandidates);
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
 * Banks due for a search: no fee link, or a stale link whose last document failed and
 * that has no live fee. Nothing is dead forever:
 * - never searched, or pending/`retry_after` older than 12 hours;
 * - a miss (`dead`, `needs_human`) after a month, then after a quarter once it has
 *   missed twice in a row (`consecutive_failures` on the bank's profile);
 * - any miss at once when its last search used an older discovery method version.
 *
 * A bank whose last search was cut short by time (`retry_after`, `out_of_time`) carries
 * that search's resume state (`discovery_resume`, from the attempt log). The first
 * `RESUME_FIRST_PER_STEP` such banks go to the front of the step so they get the full
 * per-bank budget; the rest keep their usual place.
 */
async function selectCandidates(
  db: SqlTag,
  limit: number,
  stateCode: string | undefined,
  learning: boolean,
  leaderIds: number[],
): Promise<DiscoveryCandidateRow[]> {
  const normalizedState = normalizeStateCode(stateCode);
  const currentMethod = JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION });
  return db<DiscoveryCandidateRow[]>`
    WITH due AS (
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
           profile.consecutive_failures AS profile_consecutive_failures,
           (inst.rescue_status = 'retry_after'
             AND COALESCE(inst.failure_reason_note, '') LIKE 'out_of_time:%') AS discovery_cut_off,
           row_number() OVER (ORDER BY
       CASE WHEN profile.locked_by_correction IS TRUE AND profile.canonical_source_url IS NOT NULL THEN 0 ELSE 1 END,
       -- The state's market leaders (top 15 by deposits or fee income) set its prices.
       CASE WHEN inst.id = ANY(${leaderIds}::bigint[]) THEN 0 ELSE 1 END,
       -- A bank whose page was ruled out has a page whose links point the way: search it first.
       CASE WHEN jsonb_typeof(profile.rejected_source_urls) = 'array'
             AND jsonb_array_length(profile.rejected_source_urls) > 0 THEN 0 ELSE 1 END,
       CASE WHEN inst.last_rescue_attempt_at IS NULL THEN 0 ELSE 1 END,
       CASE WHEN inst.rescue_status = 'retry_after' THEN 1 ELSE 0 END,
       inst.last_rescue_attempt_at NULLS FIRST,
       inst.asset_size DESC NULLS LAST,
       inst.id ASC
           ) AS due_rank
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (
         inst.fee_schedule_url IS NULL
         OR btrim(inst.fee_schedule_url) = ''
         -- A link the old crawler left behind that failed and was never read since
         -- (Southside Bank's ".../404") holds no live fee: search for the real page
         -- instead of waiting for the fetch queue to reach it.
         -- A 404 or 410 is due at once: 51 links fetched as 404 before the fetch step
         -- learned to clear gone links (6 Oct 2026) would otherwise wait out the 30 days.
         OR (
           (
             inst.last_crawl_at < NOW() - INTERVAL '30 days'
             OR (
               SELECT doc.status_code FROM source_documents doc
                WHERE doc.institution_id = inst.id
                ORDER BY doc.id DESC
                LIMIT 1
             ) IN (404, 410)
           )
           AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
           AND (
             SELECT doc.status FROM source_documents doc
              WHERE doc.institution_id = inst.id
              ORDER BY doc.id DESC
              LIMIT 1
           ) = 'failed'
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records fp
              WHERE fp.institution_id = inst.id AND fp.rolled_back_at IS NULL
           )
         )
       )
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
    ),
    ranked AS (
      SELECT due.*,
             row_number() OVER (PARTITION BY due.discovery_cut_off ORDER BY due.due_rank) AS cut_rank
        FROM due
    )
    SELECT ranked.*,
           CASE WHEN ${learning}::boolean AND ranked.discovery_cut_off THEN (
             SELECT pa.detail -> 'resume'
               FROM pipeline_attempts pa
              WHERE pa.institution_id = ranked.id
                AND pa.stage = 'discover'
                AND pa.detail ? 'resume'
              ORDER BY pa.created_at DESC, pa.id DESC
              LIMIT 1
           ) END AS discovery_resume
      FROM ranked
     ORDER BY
       -- Cut-off banks at the front get the whole per-bank budget to continue their search.
       CASE WHEN ranked.discovery_cut_off AND ranked.cut_rank <= ${RESUME_FIRST_PER_STEP} THEN 0 ELSE 1 END,
       ranked.due_rank
     LIMIT ${limit}
  `;
}

/**
 * Banks in other states with no fee link that no finder has ever searched (no `discover`
 * attempt), largest first. They fill a step's spare slots, so a state whose lane runs
 * rarely does not hold them back. Locked, offline and manual-review banks stay out.
 */
async function selectNeverSearchedElsewhere(db: SqlTag, limit: number, stateCode: string): Promise<DiscoveryCandidateRow[]> {
  if (limit <= 0) return [];
  const normalizedState = normalizeStateCode(stateCode);
  return db<DiscoveryCandidateRow[]>`
    -- never-searched banks in other states
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
       AND upper(btrim(COALESCE(inst.state_code, ''))) <> COALESCE(${normalizedState}::text, '')
       AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
}

/**
 * Banks whose fee link is an account or product page, an article, blog post or news
 * item (`isArticleLink`), or one deposit product's disclosure such as a CD truth-in-savings
 * sheet (`isSingleProductDisclosureLink`), not yet searched for the real schedule at this upgrade version.
 * Their link is kept until a fee schedule is found.
 */
async function selectUpgradeCandidates(db: SqlTag, limit: number, stateCode: string | undefined): Promise<DiscoveryCandidateRow[]> {
  if (limit <= 0) return [];
  const normalizedState = normalizeStateCode(stateCode);
  const upgradeMarker = JSON.stringify({ upgrade_search: UPGRADE_SEARCH_VERSION });
  const rows = await db<DiscoveryCandidateRow[]>`
    -- product-page upgrade search
    SELECT inst.id,
           inst.institution_name,
           inst.state_code,
           inst.website_url,
           inst.asset_size,
           inst.rescue_status,
           inst.fee_schedule_url,
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.source_kind AS profile_source_kind,
           profile.read_strategy AS profile_read_strategy,
           profile.locked_by_correction AS profile_locked_by_correction,
           profile.consecutive_failures AS profile_consecutive_failures
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (
             (lower(inst.fee_schedule_url) ~ ${PRODUCT_LINK_SQL} AND lower(inst.fee_schedule_url) !~ ${FEE_NAMED_LINK_SQL})
             OR (lower(inst.fee_schedule_url) ~ ${ARTICLE_LINK_SQL} AND lower(inst.fee_schedule_url) !~ ${FEE_DOCUMENT_NAME_SQL})
             OR (lower(inst.fee_schedule_url) ~ ${SINGLE_PRODUCT_SQL}
                 AND lower(inst.fee_schedule_url) ~ ${PRODUCT_DISCLOSURE_SQL}
                 AND lower(inst.fee_schedule_url) !~ ${FEE_SCHEDULE_NAME_SQL})
           )
       AND inst.website_url IS NOT NULL
       AND btrim(inst.website_url) <> ''
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.detail @> ${upgradeMarker}::jsonb
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({ ...row, upgrade: true }));
}

/**
 * Banks whose fee link is a business-only schedule, not yet searched for the consumer
 * schedule at this version. Their link is kept until a consumer schedule is found.
 */
async function selectBusinessCandidates(db: SqlTag, limit: number, stateCode: string | undefined): Promise<DiscoveryCandidateRow[]> {
  if (limit <= 0) return [];
  const normalizedState = normalizeStateCode(stateCode);
  const marker = JSON.stringify({ business_search: BUSINESS_SEARCH_VERSION });
  const rows = await db<DiscoveryCandidateRow[]>`
    -- business-only link search
    SELECT inst.id,
           inst.institution_name,
           inst.state_code,
           inst.website_url,
           inst.asset_size,
           inst.rescue_status,
           inst.fee_schedule_url,
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.source_kind AS profile_source_kind,
           profile.read_strategy AS profile_read_strategy,
           profile.locked_by_correction AS profile_locked_by_correction,
           profile.consecutive_failures AS profile_consecutive_failures
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile
        ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) ~ ${BUSINESS_PATH_SQL}
       AND lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) !~ ${CONSUMER_PATH_SQL}
       AND inst.website_url IS NOT NULL
       AND btrim(inst.website_url) <> ''
       AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
       AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.detail @> ${marker}::jsonb
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({ ...row, business: true }));
}

/**
 * Banks whose fee link looks out of date (see FRESHNESS_SEARCH_VERSION), not yet searched
 * for a newer schedule at this version. Their link is kept unless a different page
 * passes the fee-page check.
 */
async function selectStaleCandidates(
  db: SqlTag,
  limit: number,
  stateCode: string | undefined,
  now = new Date(),
): Promise<DiscoveryCandidateRow[]> {
  if (limit <= 0) return [];
  const normalizedState = normalizeStateCode(stateCode);
  const marker = JSON.stringify({ freshness_search: FRESHNESS_SEARCH_VERSION });
  const staleYear = now.getUTCFullYear() - STALE_AFTER_YEARS;
  const rows = await db<
    Array<DiscoveryCandidateRow & { effective_year: number | null; url_year: number | null; wrong_at: string | Date | null; searched_at: string | Date | null }>
  >`
    -- stale-link freshness search
    WITH due AS (
      SELECT inst.id,
             inst.institution_name,
             inst.state_code,
             inst.website_url,
             inst.asset_size,
             inst.rescue_status,
             inst.fee_schedule_url,
             profile.canonical_source_url AS profile_canonical_source_url,
             profile.source_kind AS profile_source_kind,
             profile.read_strategy AS profile_read_strategy,
             profile.locked_by_correction AS profile_locked_by_correction,
             profile.consecutive_failures AS profile_consecutive_failures,
             substring(inst.fee_schedule_url from ${URL_YEAR_SQL})::int AS url_year,
             (
               SELECT substring(left(text.normalized_text, 4000) from ${EFFECTIVE_YEAR_SQL})::int
                 FROM agent_source_texts text
                WHERE text.institution_id = inst.id
                  AND text.source_url = inst.fee_schedule_url
                  AND text.status = 'completed'
                ORDER BY text.id DESC
                LIMIT 1
             ) AS effective_year
        FROM institution_sources inst
        LEFT JOIN institution_source_profiles profile
          ON profile.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         -- One slot of banks per UTC hour when the step has no state, so the text check stays
         -- small; a state's step checks the whole state (stepSlot, as the outcome ledger).
         AND (${stepSlot(normalizedState, now)}::int IS NULL OR inst.id % ${LINK_YIELD_SLOTS} = ${stepSlot(normalizedState, now)}::int)
         AND inst.fee_schedule_url IS NOT NULL
         AND btrim(inst.fee_schedule_url) <> ''
         AND inst.website_url IS NOT NULL
         AND btrim(inst.website_url) <> ''
         AND (${normalizedState}::text IS NULL OR upper(btrim(inst.state_code)) = ${normalizedState})
         AND COALESCE(profile.locked_by_correction, FALSE) IS FALSE
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND COALESCE(profile.read_strategy, '') <> 'manual_review'
    ),
    marked AS (
      SELECT due.*,
             (
               SELECT max(pa.created_at) FROM pipeline_attempts pa
                WHERE pa.institution_id = due.id
                  AND pa.stage = 'discover'
                  AND pa.detail @> ${marker}::jsonb
             ) AS searched_at,
             -- The outcome ledger judged the link a wrong source of fees (confirmed takedowns).
             (
               SELECT max(f.updated_at) FROM pipeline_feedback f
                WHERE f.check_name = ${LINK_YIELD_CHECK}
                  AND f.kind = 'confirmed_wrong_fees'
                  AND f.institution_id = due.id
                  AND f.source_url = due.fee_schedule_url
             ) AS wrong_at
        FROM due
    )
    SELECT * FROM marked
     WHERE (COALESCE(effective_year, url_year) <= ${staleYear} AND searched_at IS NULL)
        OR (wrong_at IS NOT NULL AND (searched_at IS NULL OR searched_at < wrong_at))
     ORDER BY (wrong_at IS NOT NULL) DESC, asset_size DESC NULLS LAST, id ASC
     LIMIT ${limit}
  `;
  return rows.map(({ effective_year, url_year, wrong_at, ...row }) => ({
    ...row,
    freshness: true,
    stale_reason:
      wrong_at != null
        ? "fees read from it were confirmed wrong on a second look"
        : effective_year != null
          ? `effective ${effective_year}`
          : `address names ${url_year}`,
  }));
}

/**
 * An upgrade search found the real schedule: the product page the bank linked before stays
 * as a companion account page, so the fees read from it keep their own document stream.
 */
async function keepProductPageAsCompanion(
  db: SqlTag,
  institutionId: number,
  url: string,
  runId: number,
): Promise<void> {
  await db`
    INSERT INTO institution_additional_sources
      (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
    VALUES
      (${institutionId}, ${url}, 'html', 'account_page', 'discover.upgrade_search', ${UPGRADE_SEARCH_VERSION}, ${runId},
       'Former fee link (an account page), kept when the fee schedule was found')
    ON CONFLICT (institution_id, url) DO NOTHING
  `;
}

/** A business-only link replaced by the consumer schedule stays as a business companion. */
async function keepBusinessScheduleAsCompanion(
  db: SqlTag,
  institutionId: number,
  url: string,
  runId: number,
): Promise<void> {
  await db`
    INSERT INTO institution_additional_sources
      (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
    VALUES
      (${institutionId}, ${url}, ${/\.pdf($|\?)/i.test(url) ? "pdf" : "html"}, 'business', 'discover.business_search', ${BUSINESS_SEARCH_VERSION}, ${runId},
       'Former fee link (a business-only schedule), kept when the consumer schedule was found')
    ON CONFLICT (institution_id, url) DO NOTHING
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
  const repairedWebsite = result.websiteRepair?.save ? result.websiteRepair.repaired : null;

  // A repaired website is saved only while no person's correction locks the bank's source.
  await db`
    UPDATE institution_sources
       SET fee_schedule_url = COALESCE(${result.url}, fee_schedule_url),
           document_type = COALESCE(${result.documentType}, document_type),
           website_url = COALESCE(
             ${result.movedTo},
             CASE WHEN ${repairedWebsite}::text IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM institution_source_profiles held
                WHERE held.institution_id = ${result.institutionId}
                  AND held.locked_by_correction IS TRUE
             ) THEN ${repairedWebsite}::text END,
             website_url
           ),
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

function cutOff(row: DiscoveryCandidateRow): boolean {
  return row.discovery_cut_off === true || String(row.discovery_cut_off ?? "").toLowerCase() === "true";
}

/** The resume fields written on a search's last attempt (`detail.resume` is what the next search reads). */
function resumeDetail(result: CandidateDiscoveryResult): Record<string, unknown> {
  return {
    resume: result.resume,
    resumed_from: result.resumedFrom
      ? {
          cut_off_searches: result.resumedFrom.ticks,
          skipped_done: result.resumedFrom.done,
          gave_up_on: result.resumedFrom.skipped,
        }
      : null,
  };
}

/**
 * One `pipeline_attempts` row per specialist that ran (stage `discover`). The last row
 * carries the search's end code and `detail.resume`: where a search cut short by time
 * continues (null once a search ends), plus `detail.resumed_from` when it continued one.
 */
async function recordFinderAttempts(
  db: SqlTag,
  row: DiscoveryCandidateRow,
  result: CandidateDiscoveryResult,
  options: { runId: number; stepId: number | null },
): Promise<void> {
  const base = {
    method_version: DISCOVERY_METHOD_VERSION,
    ...(row.upgrade ? { upgrade_search: UPGRADE_SEARCH_VERSION, replaced_url: row.fee_schedule_url ?? null } : {}),
    ...(row.business ? { business_search: BUSINESS_SEARCH_VERSION, replaced_url: row.fee_schedule_url ?? null } : {}),
    ...(row.freshness
      ? { freshness_search: FRESHNESS_SEARCH_VERSION, stale_link: row.fee_schedule_url ?? null, stale_reason: row.stale_reason ?? null }
      : {}),
    website: row.website_url,
    searched_website: result.websiteRepair?.repaired ?? row.website_url,
    moved_to: result.movedTo,
    platform: result.platform,
    // Countable: a search that went on past a homepage that blocked bots.
    homepage_blocked: result.homepageBlocked,
    // An unfamiliar domain ending is left as is but flagged ("unfamiliar_tld_xyz").
    website_warnings: repairWebsiteUrl(row.website_url).warnings,
  };
  if (result.websiteRepair) {
    const repair = result.websiteRepair;
    await recordAttempt(db, {
      institutionId: result.institutionId,
      stage: "discover",
      strategy: WEBSITE_REPAIR_STRATEGY.strategy,
      version: WEBSITE_REPAIR_STRATEGY.version,
      fingerprint: null,
      outcome: repair.repaired ? "ok" : "invalid_url",
      yieldCount: repair.save ? 1 : 0,
      costMicrousd: 0,
      durationMs: 0,
      runId: options.runId,
      stepId: options.stepId,
      detail: {
        method_version: DISCOVERY_METHOD_VERSION,
        original: repair.original,
        repaired: repair.repaired,
        changes: repair.changes,
        warnings: repair.warnings,
        reason: repair.reason,
        saved: repair.save,
        locked_by_correction: repair.locked,
        // No stored registry website exists to fall back on (see discovery.ts).
        registry_fallback: repair.repaired ? null : "none_stored",
      },
    });
  }
  if (result.code === "website_unrepairable") return;
  if (result.finders.length === 0) {
    // Locked correction, no website, or a resumed search the clock stopped before its
    // next specialist: one attempt for the search as a whole.
    await recordAttempt(db, {
      institutionId: result.institutionId,
      stage: "discover",
      strategy: result.code === "locked" ? FINDERS.knownLink.strategy : FINDERS.homepageLinks.strategy,
      version: result.code === "locked" ? FINDERS.knownLink.version : FINDERS.homepageLinks.version,
      fingerprint: result.homepageHash,
      outcome: result.code === "locked" ? "ok" : result.code === "out_of_time" ? "timeout" : "invalid_url",
      yieldCount: result.url ? 1 : 0,
      costMicrousd: 0,
      durationMs: result.durationMs,
      runId: options.runId,
      stepId: options.stepId,
      detail: { ...base, pass: 1, code: result.code, url: result.url, reason: result.reason, ...resumeDetail(result) },
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
        rescue: found && result.homepageBlocked ? "blocked_homepage" : null,
        url: found ? result.url : null,
        document_type: found ? result.documentType : null,
        confidence: found ? result.confidence : null,
        reason: index === last ? result.reason : null,
        note: finder.note ?? null,
        pages_fetched: finder.fetches,
        trail: finder.trail,
        ...(index === last ? resumeDetail(result) : {}),
      },
    });
  }
}

/**
 * The state expert's advice applied (Atlas audit, 2026-10-06): specialists that found
 * links in this state run first, best success rate first, and specialists tried at least
 * AVOID_MIN_ATTEMPTS times there without a find run last. The known link always runs
 * first. Nothing is dropped, so every specialist still runs while the bank has time.
 */
export function finderOrderFromHints(hints: StateExpertHints | null): typeof FINDER_ORDER {
  if (!hints || hints.source !== "memory") return FINDER_ORDER;
  const [first, ...rest] = FINDER_ORDER;
  const byStrategy = new Map<string, (typeof FINDER_ORDER)[number]>(rest.map((finder) => [FINDERS[finder.key].strategy, finder]));
  const ordered = orderByHints([...byStrategy.keys()], hints.finderOrder, hints.avoid);
  return [first, ...ordered.map((strategy) => byStrategy.get(strategy)!)];
}

/**
 * Finders the error review marked wrong in their last two chunks (`batch-review.ts`) run
 * after the others. The known link still runs first, and nothing is dropped.
 */
export function demoteFinders(order: typeof FINDER_ORDER, demoted: ReadonlySet<string>): typeof FINDER_ORDER {
  if (demoted.size === 0) return order;
  const [first, ...rest] = order;
  const isDemoted = (finder: (typeof FINDER_ORDER)[number]) => demoted.has(FINDERS[finder.key].strategy);
  return [first, ...rest.filter((finder) => !isDemoted(finder)), ...rest.filter(isDemoted)];
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
  const leaderIds = options.leaderIds ?? (await loadMarketLeaderIds(db, { stateCode: options.stateCode ?? null }).catch(() => []));
  const found = await selectCandidates(db, limit, options.stateCode, learning, leaderIds);
  // Links that are not the schedule each keep a few reserved slots, searched right after
  // the cut-off banks resuming their search: business-only links, then product pages, then
  // links that look out of date. Spare capacity then takes more of each, in that order
  // (all need the attempt log).
  const reserved = (slots: number) => Math.min(slots, limit);
  const business = learning
    ? await selectBusinessCandidates(db, Math.max(limit - found.length, reserved(BUSINESS_RESERVED_SLOTS)), options.stateCode)
    : [];
  const upgradeSlots = Math.max(0, Math.floor(options.upgradeSlots ?? UPGRADE_RESERVED_SLOTS));
  const upgrades = learning
    ? await selectUpgradeCandidates(db, Math.max(limit - found.length - business.length, reserved(upgradeSlots)), options.stateCode)
    : [];
  const stale = learning
    ? await selectStaleCandidates(
        db,
        Math.max(limit - found.length - business.length - upgrades.length, reserved(FRESHNESS_RESERVED_SLOTS)),
        options.stateCode,
      )
    : [];
  const missing = found.slice(0, Math.max(0, limit - business.length - upgrades.length - stale.length));
  // The selector puts up to RESUME_FIRST_PER_STEP cut-off banks first; they keep the front.
  let resumeCount = 0;
  while (resumeCount < Math.min(RESUME_FIRST_PER_STEP, missing.length) && cutOff(missing[resumeCount])) resumeCount += 1;
  const rows = [
    ...missing.slice(0, resumeCount),
    ...business.slice(0, BUSINESS_RESERVED_SLOTS),
    ...upgrades.slice(0, upgradeSlots),
    ...stale.slice(0, FRESHNESS_RESERVED_SLOTS),
    ...missing.slice(resumeCount),
    ...business.slice(BUSINESS_RESERVED_SLOTS),
    ...upgrades.slice(upgradeSlots),
    ...stale.slice(FRESHNESS_RESERVED_SLOTS),
  ];
  // A state with little left to search fills its spare slots with banks no finder has ever
  // searched, in any state, largest first (65 of 405 steps on 6-7 Oct ended in under 30 s
  // while 1,418 banks with a website had never been searched).
  if (learning && options.stateCode && rows.length < limit) {
    rows.push(...(await selectNeverSearchedElsewhere(db, limit - rows.length, options.stateCode)));
  }
  const rejected = !dryRun && rows.length > 0 && (await documentVaultSchemaReady(db))
    ? await loadRejectedUrls(db, rows.map((row) => Number(row.id)))
    : new Map<number, RejectedSources>();
  const knowledge = dryRun ? NO_KNOWLEDGE : createPlatformLearner(db);
  // MG-4 in shadow: the stored classifier scores every opened candidate (trail `page_p`).
  const pageClassifier = learning ? await loadPageClassifier(db) : null;
  const hints = options.stateCode ? await stateExpertHints(options.stateCode, db).catch(() => null) : null;
  const demotedFinders = learning ? await loadDemotedFinders(db) : new Set<string>();
  const hintedOrder = finderOrderFromHints(hints);
  const finderOrder = demoteFinders(hintedOrder, demotedFinders);

  const startedAt = Date.now();
  const stepDeadline = startedAt + STEP_HARD_BUDGET_MS;
  const results: CandidateDiscoveryResult[] = [];
  for (const row of rows) {
    // Banks not reached this step stay due and are picked up by the next one.
    if (Date.now() - startedAt > STEP_START_BUDGET_MS) break;
    const institutionId = Number(row.id);
    const bankStarted = Date.now();
    const result = await discoverForInstitution(row, {
      fetchImpl,
      rejectedUrls: rejected.get(institutionId),
      knowledge,
      deadline: Math.min(bankStarted + INSTITUTION_BUDGET_MS, stepDeadline),
      politeDelayMs,
      resume: cutOff(row) ? parseDiscoveryResume(row.discovery_resume) : null,
      // The resume state lives on the attempt log, so it needs the learning schema.
      resumable: learning,
      fullBudget: bankStarted + INSTITUTION_BUDGET_MS <= stepDeadline,
      pageClassifier,
      finderOrder,
    });
    results.push(result);
    if (dryRun) continue;
    // A re-search of a bank that already has a link (product page or stale) changes it only
    // when a different page passes the fee-page check.
    const reSearch = Boolean(row.upgrade || row.business || row.freshness);
    const upgraded = Boolean(
      reSearch &&
        result.outcome === "discovered" &&
        result.url &&
        row.fee_schedule_url &&
        urlIdentity(result.url) !== urlIdentity(row.fee_schedule_url),
    );
    // A re-search that finds nothing new leaves the bank's link and rescue state alone.
    if (!reSearch || upgraded) await recordDiscoveryResult(db, result);
    // An article, blog link or one product's disclosure is not kept beside the schedule: its amounts were never the bank's schedule.
    if (upgraded && row.upgrade && row.fee_schedule_url && !isArticleLink(row.fee_schedule_url) && !isSingleProductDisclosureLink(row.fee_schedule_url)) {
      await keepProductPageAsCompanion(db, institutionId, row.fee_schedule_url, options.runId);
    }
    if (upgraded && row.business && row.fee_schedule_url) {
      await keepBusinessScheduleAsCompanion(db, institutionId, row.fee_schedule_url, options.runId);
    }
    if (learning) await recordFinderAttempts(db, row, result, { runId: options.runId, stepId: options.stepId ?? null });
    if ((!reSearch || upgraded) && result.outcome === "discovered" && result.url && result.code !== "locked") {
      await knowledge.recordFind({ platform: result.platform, url: result.url, foundByPlatformPath: result.foundBy === "platformPaths" || result.foundBy === "peerHint" });
    }
  }

  // Database work only (no fetches), so it runs before the companion search, which uses
  // the rest of the step's time: behind it, the restore never ran on 7 Oct (0 of 58 due).
  const restoredFeePages = learning && options.mode !== "rescue"
    ? await inSavepoint(db, (scope) => restoreSwappedFeePages({
        db: scope,
        runId: options.runId,
        stepId: options.stepId ?? null,
        stateCode: options.stateCode ?? null,
        dryRun,
      })).catch((error) => {
        console.error("restoreSwappedFeePages failed:", error);
        return null;
      })
    : null;
  // Database work only, like the restore. Not limited to the lane's state: the answers were
  // paid for already and each bank is kept once.
  const keptRefusedAnswers = learning && options.mode !== "rescue"
    ? await inSavepoint(db, (scope) => keepRefusedPaidAnswers({
        db: scope,
        runId: options.runId,
        stepId: options.stepId ?? null,
        dryRun,
      })).catch((error) => {
        console.error("keepRefusedPaidAnswers failed:", error);
        return null;
      })
    : null;
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

  // A bank searched from scratch that ended with nothing leaves a lesson (search-misses.ts).
  const searchMisses = learning && !dryRun
    ? await recordSearchMisses(
        db,
        results.filter((result) => {
          const row = rows.find((candidate) => Number(candidate.id) === result.institutionId);
          return row && !(row.upgrade || row.business || row.freshness);
        }),
        {
          runId: options.runId,
          method: DISCOVERY_METHOD,
          methodVersion: DISCOVERY_METHOD_VERSION,
          websites: new Map(rows.map((row) => [Number(row.id), row.website_url])),
        },
      )
    : 0;

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
    resumed: results.filter((result) => result.resumedFrom !== null).length,
    foundBy,
    websitesRepaired: results.filter((result) => result.websiteRepair?.save).length,
    blockedHomepageRescues: results.filter((result) => result.code === "found_blocked_homepage").length,
    learning,
    pageClassifier: pageClassifier ? { trainedAt: pageClassifier.trainedAt, positives: pageClassifier.positives, negatives: pageClassifier.negatives } : null,
    finderOrder: {
      strategies: finderOrder.map((finder) => FINDERS[finder.key].strategy),
      source: hintedOrder === FINDER_ORDER ? "default" : "state_expert",
      demoted: [...demotedFinders],
    },
    methodVersion: DISCOVERY_METHOD_VERSION,
    secondDocuments,
    restoredFeePages,
    keptRefusedAnswers,
    searchMisses,
    limit,
    dryRun,
    results,
  };
}
