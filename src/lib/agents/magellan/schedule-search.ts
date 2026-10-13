import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { loadMarketLeaderIds } from "@/lib/data-store/market-leaders";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { PAID_PASS_MODELS, paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";

import { FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS } from "./cooldowns";
import { looksLikePdfUrl, validateFeeCandidate } from "./find-validate";
import { urlIdentity } from "./finders";
import {
  BUSINESS_PATH_SQL,
  CONSUMER_PATH_SQL,
  DOCUMENT_YEAR_SQL,
  FEE_NAMED_LINK_SQL,
  hasOverdraftPrice,
  HIDDEN_BELOW_CATEGORIES,
  LARGE_BANK_ASSETS,
  onBankDomain,
  OVERDRAFT_PRICE_SQL,
  PRODUCT_LINK_SQL,
  REFERS_ELSEWHERE_SQL,
  STALE_DOCUMENT_YEARS,
  websiteHost,
} from "./link-coverage";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Magellan's paid schedule search, in two lanes (#1030).
 *
 * **Uncovered first.** Institutions that hold a fee link but have no live fee at all: the free
 * pipeline read what we hold and nothing went live. One search asks for all three documents a
 * bank lists its fees in (the fee schedule, the Truth in Savings disclosure and the deposit
 * account agreement), because small banks and credit unions often publish only the second or
 * third. Each answer that passes the checks is stored as its own companion document. Before
 * #1030, 272 of the 1,037 institutions searched in the 7 days to 2026-10-13 already had live
 * fees, and 949 already had a stored document.
 *
 * **Gap-filling second, on its own small cap.** Banks with live fees whose page is not the
 * consumer schedule yet (link-coverage.ts): a business-only schedule, a page with no overdraft
 * price (Wells Fargo's Clear Access summary), a page that sends the reader to the account
 * agreement, a stale copy, or fewer than three live categories. A few per step, and none once
 * the lane has spent `GAP_FILL_CAP_MICROUSD` in the last `GAP_FILL_CAP_DAYS`.
 *
 * Every answer must be on the bank's domain, new to the bank, and pass the same fee-page check
 * as every finder. It is stored beside the bank's link as a companion document, so the bank
 * keeps its link and live fees; companion fetch, Rosetta and Knox read the new document next.
 * Selection is national (requesters, market leaders, $10B+, then largest first) until the
 * state experts' work lists (#1029) set the order.
 */

export const SCHEDULE_SEARCH_STRATEGY = { strategy: "discover.paid_schedule_search", version: 2 } as const;
/** Uncovered institutions (no live fee) one paid step searches. Not tied to the step's state. */
export const SCHEDULE_SEARCH_PER_RUN = 10;
/** Covered banks one paid step searches to fill a gap (the gap-fill lane). */
export const GAP_FILL_PER_RUN = 3;
/** The gap-fill lane's own cap: no gap-fill search once the lane spent this in `GAP_FILL_CAP_DAYS`. */
export const GAP_FILL_CAP_MICROUSD = 10_000_000;
export const GAP_FILL_CAP_DAYS = 30;
/**
 * Days the bank's oldest stored copy must have before it counts as uncovered, so the free
 * pipeline (Rosetta, Knox, Darwin) reads a new link before a paid search second-guesses it.
 */
export const UNCOVERED_SETTLE_DAYS = 3;

export type ScheduleSearchLane = "uncovered" | "gap_fill";
/** The three documents the uncovered lane asks for, in the order their answers are checked. */
export const UNCOVERED_DOCUMENT_KINDS = ["fee_schedule", "truth_in_savings", "account_agreement"] as const;
export type UncoveredDocumentKind = (typeof UNCOVERED_DOCUMENT_KINDS)[number];
type DocumentKind = UncoveredDocumentKind | "consumer_schedule";
const KIND_LABEL: Record<DocumentKind, string> = {
  fee_schedule: "fee schedule",
  truth_in_savings: "Truth in Savings disclosure",
  account_agreement: "deposit account agreement",
  consumer_schedule: "consumer fee schedule",
};

const WEB_SEARCH_MAX_USES = 3;
const MAX_OUTPUT_TOKENS = 1024;
const ANSWER_SCORE = 0.85;
const COVERAGE_TEXT_CHARS = 60_000;
const TRANSIENT_OUTCOMES = ["network_error", "timeout", "http_5xx", "http_429", "budget_blocked"];
/** Paid tries a bank gets in MISS_COOLDOWN_DAYS when every one ends in a timeout or refusal. */
export const MAX_TRANSIENT_TRIES = 3;

export interface ScheduleSearchRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  website_url: string;
  fee_schedule_url: string;
  asset_size: number | string | null;
  requested: boolean | null;
  /** In its state's top 15 by deposits, service charge income or total income. */
  leader?: boolean | null;
  /** No live fee at all: the uncovered lane. Otherwise the gap-fill lane. */
  uncovered?: boolean | null;
  business_only: boolean | null;
  /** The free business search already looked for the consumer schedule. */
  business_searched?: boolean | null;
  no_overdraft_price: boolean | null;
  refers_elsewhere: boolean | null;
  stale_copy?: boolean | null;
  hidden?: boolean | null;
  product_page?: boolean | null;
}

interface ScheduleAnswer {
  url?: unknown;
  evidence?: unknown;
}

type UncoveredAnswer = Partial<Record<UncoveredDocumentKind, unknown>> & { evidence?: unknown };

export interface ScheduleSearchResult {
  selected: number;
  processed: number;
  /** Institutions with at least one document found. */
  found: number;
  /** Companion documents stored (the uncovered lane can store up to three per institution). */
  documents: number;
  costMicrousd: number;
  budgetStopped: boolean;
  budgetReason: string | null;
  results: Array<Record<string, unknown>>;
}

export function laneOf(row: Pick<ScheduleSearchRow, "uncovered">): ScheduleSearchLane {
  return row.uncovered ? "uncovered" : "gap_fill";
}

/** Why the page we hold is not the schedule, in the prompt's words. */
function whyNotIt(row: ScheduleSearchRow): string {
  if (row.uncovered) return "we could read no fees from it";
  if (row.business_only) return "it is the business account schedule, not the personal one";
  if (row.refers_elsewhere) return "it refers to the deposit account agreement or another document for the fees";
  if (row.product_page) return "it is an account product page, not the fee schedule";
  if (row.hidden && !row.no_overdraft_price) return "we could read fewer than three fees from it, so it is not the full fee schedule";
  if (row.stale_copy && !row.no_overdraft_price) return "it is dated several years ago and its prices are likely out of date; find the current edition";
  return "it does not list the overdraft or NSF fee amount";
}

function bankLines(row: ScheduleSearchRow): string[] {
  return [
    `Bank: ${row.institution_name}`,
    `Location: ${[row.city, row.state_code].filter(Boolean).join(", ") || "unknown"}`,
    `Website: ${row.website_url}`,
  ];
}

/** The uncovered lane's ask: every document that may list the bank's consumer fees. */
export function uncoveredSearchPrompt(row: ScheduleSearchRow): string {
  const site = websiteHost(row.website_url) ?? row.website_url;
  return [
    "We have no fee data for this bank yet. Find the URLs of the bank's consumer (personal) documents",
    "that list deposit account fees with dollar amounts (overdraft, NSF / returned item, stop payment,",
    "wires, monthly maintenance). Look for each of these three; smaller banks and credit unions often",
    "publish only the second or third:",
    "- fee_schedule: the fee schedule (\"Schedule of Fees\", \"Schedule of Charges\", \"Fee Schedule\", \"Consumer Fees\").",
    "- truth_in_savings: the Truth in Savings disclosure (\"Truth in Savings\", \"Account Disclosures\",",
    "  \"Deposit Account Disclosure\") that states account fees.",
    "- account_agreement: the deposit account agreement (\"Deposit Account Agreement\", \"Membership Agreement\",",
    "  \"Account Terms and Conditions\") with a fee section.",
    "",
    ...bankLines(row),
    `We already have ${row.fee_schedule_url}, but ${whyNotIt(row)}. Find different documents.`,
    "",
    "Rules:",
    `- Each URL must be on the bank's own domain (${site}, a subdomain of it, or its parent company's domain).`,
    "- Not a business or commercial document, a rate sheet, a single CD disclosure, a press release, or a marketing page.",
    "- Use null for any document you cannot find. Do not guess a URL you have not seen.",
    "",
    "Answer with JSON only:",
    "{\"fee_schedule\": string | null, \"truth_in_savings\": string | null, \"account_agreement\": string | null, \"evidence\": \"one short sentence\"}",
  ].join("\n");
}

/** The gap-fill lane's ask: the consumer schedule a covered bank's held page is not. */
export function scheduleSearchPrompt(row: ScheduleSearchRow): string {
  if (row.uncovered) return uncoveredSearchPrompt(row);
  const site = websiteHost(row.website_url) ?? row.website_url;
  return [
    "Find the URL of this bank's consumer (personal) fee schedule: the document, usually a PDF,",
    "that lists personal deposit account fees with dollar amounts, including the overdraft and",
    "NSF / returned item fee, stop payment, wires and monthly maintenance. It may be titled",
    "\"Schedule of Fees\", \"Schedule of Charges\", \"Schedule of Service Charges\", \"Personal Fee Schedule\",",
    "\"Account Fee Schedule\", \"Consumer Fees\", \"Consumer Deposit Account Agreement\" or \"Truth in Savings",
    "Disclosure\". Large banks often publish it on their parent company's domain.",
    "",
    ...bankLines(row),
    `We already have ${row.fee_schedule_url}, but ${whyNotIt(row)}. Find a different document.`,
    "",
    "Rules:",
    `- The URL must be on the bank's own domain (${site}, a subdomain of it, or its parent company's domain).`,
    "- Not a business or commercial schedule, a rate sheet, a press release, or a marketing page.",
    "- If you cannot find it, answer with url null. Do not guess a URL you have not seen.",
    "",
    "Answer with JSON only:",
    "{\"url\": string | null, \"evidence\": \"one short sentence\"}",
  ].join("\n");
}

/** The URLs one answer proposes, by kind, in check order; repeats of one URL are checked once. */
export function proposedDocuments(row: Pick<ScheduleSearchRow, "uncovered">, answer: unknown): Array<{ kind: DocumentKind; url: string }> {
  if (!answer || typeof answer !== "object") return [];
  const record = answer as Record<string, unknown>;
  const asked: Array<[DocumentKind, unknown]> = row.uncovered
    ? UNCOVERED_DOCUMENT_KINDS.map((kind) => [kind, record[kind]])
    : [["consumer_schedule", record.url]];
  const seen = new Set<string>();
  const proposals: Array<{ kind: DocumentKind; url: string }> = [];
  for (const [kind, value] of asked) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url || seen.has(urlIdentity(url))) continue;
    seen.add(urlIdentity(url));
    proposals.push({ kind, url });
  }
  return proposals;
}

/**
 * Two lanes, neither on the paid cooldown (`cooldowns.ts`):
 * - uncovered (up to `limit`): no live fee at all, a held link whose first copy is at least
 *   `UNCOVERED_SETTLE_DAYS` old, and no companion still waiting for its first fetch;
 * - gap_fill (up to `gapLimit`): banks with live fees whose link is not the consumer schedule
 *   yet. $10B+ banks, report requesters and each state's market leaders (`leaderIds`, top 15
 *   by deposits or fee income) on any gap; others when the catalog hides them (fewer than
 *   three live categories) and their page is a product page or prices no overdraft, or when
 *   the link is business-only and the free business search missed.
 * Each lane: requesters, then priority names, then leaders, then largest first.
 */
async function selectRows(db: SqlTag, limit: number, gapLimit: number, leaderIds: number[]): Promise<ScheduleSearchRow[]> {
  return db<ScheduleSearchRow[]>`
    -- incomplete-link schedule search
    WITH live AS (
      SELECT record.institution_id, count(DISTINCT record.canonical_fee_key)::int AS categories
        FROM published_fee_records record
       WHERE record.rolled_back_at IS NULL
       GROUP BY record.institution_id
    ),
    scoped AS (
      SELECT inst.id, inst.institution_name, inst.city, inst.state_code, inst.website_url, inst.fee_schedule_url, inst.asset_size,
             EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id) AS requested,
             inst.id = ANY(${leaderIds}::bigint[]) AS leader,
             (
               inst.asset_size >= ${LARGE_BANK_ASSETS}
               OR inst.id = ANY(${leaderIds}::bigint[])
               OR EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id)
             ) AS priority,
             COALESCE(live.categories, 0) = 0 AS uncovered,
             EXISTS (
               SELECT 1 FROM source_documents settled
                WHERE settled.institution_id = inst.id
                  AND settled.crawled_at < NOW() - make_interval(days => ${UNCOVERED_SETTLE_DAYS}::int)
             ) AS settled,
             EXISTS (
               SELECT 1 FROM institution_additional_sources waiting
                WHERE waiting.institution_id = inst.id
                  AND waiting.status = 'found'
                  AND waiting.last_fetched_at IS NULL
                  AND waiting.document_role <> 'business'
             ) AS companion_waiting,
             COALESCE(live.categories, 0) < ${HIDDEN_BELOW_CATEGORIES} AS hidden,
             (lower(inst.fee_schedule_url) ~ ${PRODUCT_LINK_SQL} AND lower(inst.fee_schedule_url) !~ ${FEE_NAMED_LINK_SQL}) AS product_page,
             (
               lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) ~ ${BUSINESS_PATH_SQL}
               AND lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) !~ ${CONSUMER_PATH_SQL}
             ) AS business_only,
             EXISTS (
               SELECT 1 FROM pipeline_attempts searched
                WHERE searched.institution_id = inst.id
                  AND searched.stage = 'discover'
                  AND searched.detail ? 'business_search'
             ) AS business_searched,
             NOT EXISTS (
               SELECT 1 FROM agent_source_texts text
                WHERE text.institution_id = inst.id
                  AND text.status = 'completed'
                  AND left(text.normalized_text, ${COVERAGE_TEXT_CHARS}) ~* ${OVERDRAFT_PRICE_SQL}
             ) AS no_overdraft_price,
             EXISTS (
               SELECT 1 FROM agent_source_texts text
                WHERE text.institution_id = inst.id
                  AND text.status = 'completed'
                  AND left(text.normalized_text, ${COVERAGE_TEXT_CHARS}) ~* ${REFERS_ELSEWHERE_SQL}
             ) AS refers_elsewhere,
             EXISTS (
               SELECT 1 FROM source_documents doc
                WHERE doc.institution_id = inst.id
                  AND doc.status = 'success'
                  AND doc.duplicate_of_id IS NULL
                  AND doc.superseded_by_id IS NULL
                  AND substring(doc.document_url from ${DOCUMENT_YEAR_SQL})::int
                      <= extract(year from NOW())::int - ${STALE_DOCUMENT_YEARS}
             ) AS stale_copy
        FROM institution_sources inst
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
        LEFT JOIN live ON live.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
         AND inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> ''
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND COALESCE(profile.read_strategy, '') <> 'manual_review'
         AND COALESCE(profile.locked_by_correction, false) = false
         -- On cooldown (#1031): one real answer in the last FOUND_COOLDOWN_DAYS (a find) or
         -- MISS_COOLDOWN_DAYS (a miss), or MAX_TRANSIENT_TRIES that timed out or were refused
         -- in the last MISS_COOLDOWN_DAYS (Morgan Stanley and Northern Trust timed out 35
         -- times in 9 hours).
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.institution_id = inst.id
              AND pa.stage = 'discover'
              AND pa.strategy = ${SCHEDULE_SEARCH_STRATEGY.strategy}
              AND pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok' THEN ${FOUND_COOLDOWN_DAYS}::int ELSE ${MISS_COOLDOWN_DAYS}::int END)
              AND pa.outcome <> ALL(${TRANSIENT_OUTCOMES})
         )
         AND (
           SELECT count(*) FROM pipeline_attempts pa
            WHERE pa.institution_id = inst.id
              AND pa.stage = 'discover'
              AND pa.strategy = ${SCHEDULE_SEARCH_STRATEGY.strategy}
              AND pa.created_at >= NOW() - make_interval(days => ${MISS_COOLDOWN_DAYS}::int)
              AND pa.outcome <> 'budget_blocked'
         ) < ${MAX_TRANSIENT_TRIES}
    )
    , lanes AS (
      SELECT scoped.*,
             row_number() OVER (PARTITION BY uncovered ORDER BY requested DESC, priority DESC, leader DESC, asset_size DESC NULLS LAST, id ASC) AS lane_rank
        FROM scoped
       WHERE (uncovered AND settled AND NOT companion_waiting)
          OR (NOT uncovered AND priority AND (business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy OR hidden))
          OR (NOT uncovered AND hidden AND (product_page OR no_overdraft_price))
          -- Any covered bank whose link is a business-only schedule, once the free business search missed.
          OR (NOT uncovered AND business_only AND business_searched)
    )
    SELECT * FROM lanes
     WHERE (uncovered AND lane_rank <= ${limit}) OR (NOT uncovered AND lane_rank <= ${gapLimit})
     ORDER BY uncovered DESC, lane_rank ASC
  `;
}

/** What the gap-fill lane spent in the last `GAP_FILL_CAP_DAYS`. */
async function gapFillSpent(db: SqlTag): Promise<number> {
  const rows = await db<Array<{ spent: number | string | null }>>`
    -- gap-fill lane spend
    SELECT COALESCE(sum(pa.cost_microusd), 0)::bigint AS spent
      FROM pipeline_attempts pa
     WHERE pa.stage = 'discover'
       AND pa.strategy = ${SCHEDULE_SEARCH_STRATEGY.strategy}
       AND pa.detail->>'lane' = 'gap_fill'
       AND pa.created_at >= NOW() - make_interval(days => ${GAP_FILL_CAP_DAYS}::int)
  `;
  return Number(rows?.[0]?.spent ?? 0) || 0;
}

/** Market leaders across every state; none (the lane falls back to size) if the ranking fails. */
async function leaderIdsOrNone(db: SqlTag): Promise<number[]> {
  try {
    return await loadMarketLeaderIds(db);
  } catch {
    return [];
  }
}

/** Documents this bank already has, as link, stored document or companion. */
async function knownUrls(db: SqlTag, institutionId: number, link: string): Promise<Set<string>> {
  const rows = await db`
    SELECT document_url AS url FROM source_documents WHERE institution_id = ${institutionId} AND document_url IS NOT NULL
    UNION
    SELECT url FROM institution_additional_sources WHERE institution_id = ${institutionId}
  `;
  return new Set([urlIdentity(link), ...rows.map((row) => urlIdentity(String(row.url)))]);
}

function budgetStop(error: unknown): string | null {
  if (error instanceof ProviderBudgetBlockedError) return error.message || error.reasonCode;
  if (error instanceof EmergencyStopActiveError) return error.message;
  return null;
}

interface CheckedDocument {
  kind: DocumentKind;
  proposed_url: string;
  outcome: AttemptOutcome;
  url: string | null;
  document_type: string | null;
  verdict: string | null;
  overdraft_price_seen: boolean | null;
  reason: string;
}

/** One proposed URL through the domain, already-held and fee-page checks. */
async function checkProposal(
  proposal: { kind: DocumentKind; url: string },
  row: ScheduleSearchRow,
  known: Set<string>,
  fetchImpl: Fetcher,
): Promise<CheckedDocument> {
  const { kind, url: proposed } = proposal;
  const label = KIND_LABEL[kind];
  const checked: CheckedDocument = {
    kind, proposed_url: proposed, outcome: "rejected", url: null, document_type: null, verdict: null, overdraft_price_seen: null, reason: "",
  };
  if (!onBankDomain(proposed, row.website_url)) {
    return { ...checked, outcome: "invalid_url", reason: `Answer (${label}) is not on the bank's domain: ${proposed}` };
  }
  if (known.has(urlIdentity(proposed))) {
    return { ...checked, outcome: "rejected", reason: `Answer (${label}) is a document the bank already has: ${proposed}` };
  }
  try {
    const validation = await validateFeeCandidate({ url: proposed, score: ANSWER_SCORE, reasons: [`paid schedule search: ${label}`] }, fetchImpl);
    checked.verdict = validation.verdict;
    if (validation.ok) {
      return {
        ...checked,
        outcome: "ok",
        url: proposed,
        document_type: validation.documentType ?? (looksLikePdfUrl(proposed) ? "pdf" : "html"),
        overdraft_price_seen: validation.scoringText ? hasOverdraftPrice(validation.scoringText) : null,
        reason: `Paid schedule search (${label}): ${validation.reason}`,
      };
    }
    if (validation.status === 403) {
      // The bank's site refuses our fetcher: keep the answer for the paid fetch, as the
      // paid web search does (paid-find.ts). Desert Financial's lost this way, 8 Oct 2026.
      return {
        ...checked,
        outcome: "ok",
        url: proposed,
        document_type: looksLikePdfUrl(proposed) ? "pdf" : "html",
        reason: `Paid schedule search (${label}); the bank's site refused our check (HTTP 403), kept for the paid fetch: ${proposed}`,
      };
    }
    return {
      ...checked,
      outcome: validation.status != null && validation.status >= 400 ? classifyFetchFailure(validation.status) : "wrong_document",
      reason: `Answer (${label}) failed the fee-page check (${validation.reason}): ${proposed}`,
    };
  } catch (error) {
    return {
      ...checked,
      outcome: classifyFetchFailure(null, error),
      reason: `Answer (${label}) could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runScheduleSearch(options: {
  runId: number;
  stepId?: number | null;
  limit?: number;
  /** Gap-fill searches this step (at most `GAP_FILL_PER_RUN`). */
  gapLimit?: number;
  /** Market leader ids; loaded from the shared ranking when left out. */
  leaderIds?: number[];
  dryRun?: boolean;
  db?: SqlTag;
  create?: PaidMessageCreator;
  fetchImpl?: Fetcher;
}): Promise<ScheduleSearchResult> {
  const db = options.db ?? sql;
  const result: ScheduleSearchResult = {
    selected: 0, processed: 0, found: 0, documents: 0, costMicrousd: 0, budgetStopped: false, budgetReason: null, results: [],
  };
  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit ?? SCHEDULE_SEARCH_PER_RUN)) || SCHEDULE_SEARCH_PER_RUN, SCHEDULE_SEARCH_PER_RUN));
  const gapSpent = await gapFillSpent(db);
  const requestedGap = Math.max(0, Math.min(Math.floor(Number(options.gapLimit ?? GAP_FILL_PER_RUN)) || 0, GAP_FILL_PER_RUN));
  const gapLimit = gapSpent >= GAP_FILL_CAP_MICROUSD ? 0 : requestedGap;
  const leaderIds = options.leaderIds ?? (await leaderIdsOrNone(db));
  const rows = await selectRows(db, limit, gapLimit, leaderIds);
  result.selected = rows.length;
  if (options.dryRun) {
    result.results = rows.map((row) => ({
      institution_id: Number(row.id),
      institution_name: row.institution_name,
      lane: laneOf(row),
      would_search_schedule: true,
      why: whyNotIt(row),
    }));
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = PAID_PASS_MODELS.find();
  let gapSpentNow = gapSpent;
  for (const row of rows) {
    const institutionId = Number(row.id);
    const lane = laneOf(row);
    // The lane's cap is checked again before each search, so one step cannot run past it.
    if (lane === "gap_fill" && gapSpentNow >= GAP_FILL_CAP_MICROUSD) {
      result.results.push({ institution_id: institutionId, lane, outcome: "skipped", reason: "Gap-fill lane is at its cap", by: "schedule_search" });
      continue;
    }
    const startedAt = Date.now();
    let costMicrousd = 0;
    let outcome: AttemptOutcome;
    let reason: string;
    let evidence: string | null = null;
    let proposals: Array<{ kind: DocumentKind; url: string }> = [];
    const documents: CheckedDocument[] = [];

    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "schedule_search",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null, lane },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
          messages: [{ role: "user", content: scheduleSearchPrompt(row) }],
        },
      });
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      if (lane === "gap_fill") gapSpentNow += costMicrousd;
      const answer = paidResponseJson<ScheduleAnswer | UncoveredAnswer>(call.message);
      evidence = typeof answer?.evidence === "string" ? answer.evidence.slice(0, 300) : null;
      proposals = proposedDocuments(row, answer);
      if (proposals.length === 0) {
        outcome = "no_candidates";
        reason = lane === "uncovered"
          ? "Web search found no fee schedule, Truth in Savings disclosure or account agreement"
          : "Web search found no consumer fee schedule";
      } else {
        const known = await knownUrls(db, institutionId, row.fee_schedule_url);
        for (const proposal of proposals) {
          const checked = await checkProposal(proposal, row, known, fetchImpl);
          documents.push(checked);
          if (checked.url) known.add(urlIdentity(checked.url));
        }
        const kept = documents.filter((document) => document.url);
        // One find is a find; otherwise the first answer's outcome (the schedule's, when asked).
        outcome = kept.length > 0 ? "ok" : documents[0].outcome;
        reason = kept.length > 0 ? kept.map((document) => document.reason).join("; ") : documents[0].reason;
      }
    } catch (error) {
      const stopped = budgetStop(error);
      if (stopped) {
        result.budgetStopped = true;
        result.budgetReason = stopped;
        break;
      }
      outcome = classifyFetchFailure(null, error);
      reason = `Model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    result.processed += 1;
    const kept = documents.filter((document): document is CheckedDocument & { url: string } => Boolean(document.url));
    if (kept.length > 0) result.found += 1;
    for (const document of kept) {
      result.documents += 1;
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${document.url}, ${document.document_type}, 'consumer_supplement', ${SCHEDULE_SEARCH_STRATEGY.strategy},
           ${SCHEDULE_SEARCH_STRATEGY.version}, ${options.runId}, ${document.reason})
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    const first = kept[0] ?? documents[0] ?? null;
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: SCHEDULE_SEARCH_STRATEGY.strategy,
      version: SCHEDULE_SEARCH_STRATEGY.version,
      fingerprint: urlIdentity(row.fee_schedule_url),
      outcome,
      yieldCount: kept.length,
      costMicrousd,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 3,
        model,
        lane,
        url: kept[0]?.url ?? null,
        held_link: row.fee_schedule_url,
        why_searched: whyNotIt(row),
        proposed_url: proposals[0]?.url ?? null,
        evidence,
        verdict: first?.verdict ?? null,
        document_type: kept[0]?.document_type ?? null,
        overdraft_price_seen: kept[0]?.overdraft_price_seen ?? null,
        documents,
        reason,
      },
    });
    result.results.push({
      institution_id: institutionId,
      lane,
      outcome,
      url: kept[0]?.url ?? null,
      urls: kept.map((document) => ({ kind: document.kind, url: document.url })),
      cost_microusd: costMicrousd,
      reason,
      by: "schedule_search",
    });
  }
  return result;
}
