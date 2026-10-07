import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { PAID_PASS_MODELS, paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";

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
 * The names buyers check first get a paid search for their consumer fee schedule when the
 * page we hold is not it (link-coverage.ts): a business-only schedule, a page with no
 * overdraft price (Wells Fargo's Clear Access summary, JPMorgan Chase's press release on
 * Oct 6), or a page that sends the reader to the account agreement. Banks over $10B and
 * report requesters only, largest first, a few per paid step, inside Magellan's paid caps.
 *
 * The answer must be on the bank's domain and pass the same fee-page check as every
 * finder. It is stored beside the bank's link as a companion document, so the bank keeps
 * its link and live fees; companion fetch, Rosetta and Knox read the new document next.
 */

export const SCHEDULE_SEARCH_STRATEGY = { strategy: "discover.paid_schedule_search", version: 1 } as const;
/** Banks one paid step searches. Not tied to the step's state: these are national names. */
export const SCHEDULE_SEARCH_PER_RUN = 10;
/**
 * Banks of any size hidden from the index because we read fewer than three fees for them
 * (the catalog's 3-fee rule) and whose stored page is an account product page or prices no
 * overdraft: a product, rate or Truth-in-Savings page, not the schedule.
 * A few per paid step, largest first, beside the large-bank lane (Knox handoff, Oct 7).
 */
export const HIDDEN_BANK_SEARCH_PER_RUN = 10;
const WEB_SEARCH_MAX_USES = 3;
const MAX_OUTPUT_TOKENS = 1024;
const ANSWER_SCORE = 0.85;
const COVERAGE_TEXT_CHARS = 60_000;
const TRANSIENT_OUTCOMES = ["network_error", "timeout", "http_5xx", "http_429", "budget_blocked"];

export interface ScheduleSearchRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  website_url: string;
  fee_schedule_url: string;
  asset_size: number | string | null;
  requested: boolean | null;
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

export interface ScheduleSearchResult {
  selected: number;
  processed: number;
  found: number;
  costMicrousd: number;
  budgetStopped: boolean;
  budgetReason: string | null;
  results: Array<Record<string, unknown>>;
}

/** Why the page we hold is not the schedule, in the prompt's words. */
function whyNotIt(row: ScheduleSearchRow): string {
  if (row.business_only) return "it is the business account schedule, not the personal one";
  if (row.refers_elsewhere) return "it refers to the deposit account agreement or another document for the fees";
  if (row.product_page) return "it is an account product page, not the fee schedule";
  if (row.hidden && !row.no_overdraft_price) return "we could read fewer than three fees from it, so it is not the full fee schedule";
  if (row.stale_copy && !row.no_overdraft_price) return "it is dated several years ago and its prices are likely out of date; find the current edition";
  return "it does not list the overdraft or NSF fee amount";
}

export function scheduleSearchPrompt(row: ScheduleSearchRow): string {
  const site = websiteHost(row.website_url) ?? row.website_url;
  return [
    "Find the URL of this bank's consumer (personal) fee schedule: the document, usually a PDF,",
    "that lists personal deposit account fees with dollar amounts, including the overdraft and",
    "NSF / returned item fee, stop payment, wires and monthly maintenance. It may be titled",
    "\"Schedule of Fees\", \"Schedule of Charges\", \"Schedule of Service Charges\", \"Personal Fee Schedule\",",
    "\"Account Fee Schedule\", \"Consumer Fees\", \"Consumer Deposit Account Agreement\" or \"Truth in Savings",
    "Disclosure\". Large banks often publish it on their parent company's domain.",
    "",
    `Bank: ${row.institution_name}`,
    `Location: ${[row.city, row.state_code].filter(Boolean).join(", ") || "unknown"}`,
    `Website: ${row.website_url}`,
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

/** $10B+ banks and report requesters whose link is not the consumer schedule yet, not searched this month. */
/**
 * Two lanes: $10B+ banks and report requesters whose link is not the consumer schedule yet
 * (up to `limit`), and banks of any size the catalog hides for having fewer than three
 * live fees (up to `hiddenLimit`). Neither searched this month.
 */
async function selectRows(db: SqlTag, limit: number, hiddenLimit: number): Promise<ScheduleSearchRow[]> {
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
             (inst.asset_size >= ${LARGE_BANK_ASSETS} OR EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id)) AS priority,
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
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.institution_id = inst.id
              AND pa.stage = 'discover'
              AND pa.strategy = ${SCHEDULE_SEARCH_STRATEGY.strategy}
              AND pa.created_at >= date_trunc('month', NOW())
              AND pa.outcome <> ALL(${TRANSIENT_OUTCOMES})
         )
    )
    , lanes AS (
      SELECT scoped.*,
             row_number() OVER (PARTITION BY priority ORDER BY requested DESC, asset_size DESC NULLS LAST, id ASC) AS lane_rank
        FROM scoped
       WHERE (priority AND (business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy))
          OR (NOT priority AND hidden AND (product_page OR no_overdraft_price))
          -- Any bank whose link is a business-only schedule, once the free business search missed.
          OR (NOT priority AND business_only AND business_searched)
    )
    SELECT * FROM lanes
     WHERE (priority AND lane_rank <= ${limit}) OR (NOT priority AND lane_rank <= ${hiddenLimit})
     ORDER BY priority DESC, requested DESC, asset_size DESC NULLS LAST, id ASC
  `;
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

export async function runScheduleSearch(options: {
  runId: number;
  stepId?: number | null;
  limit?: number;
  hiddenLimit?: number;
  dryRun?: boolean;
  db?: SqlTag;
  create?: PaidMessageCreator;
  fetchImpl?: Fetcher;
}): Promise<ScheduleSearchResult> {
  const db = options.db ?? sql;
  const result: ScheduleSearchResult = { selected: 0, processed: 0, found: 0, costMicrousd: 0, budgetStopped: false, budgetReason: null, results: [] };
  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit ?? SCHEDULE_SEARCH_PER_RUN)) || SCHEDULE_SEARCH_PER_RUN, SCHEDULE_SEARCH_PER_RUN));
  const rows = await selectRows(db, limit, options.hiddenLimit ?? HIDDEN_BANK_SEARCH_PER_RUN);
  result.selected = rows.length;
  if (options.dryRun) {
    result.results = rows.map((row) => ({
      institution_id: Number(row.id),
      institution_name: row.institution_name,
      would_search_schedule: true,
      why: whyNotIt(row),
    }));
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = PAID_PASS_MODELS.find();
  for (const row of rows) {
    const institutionId = Number(row.id);
    const startedAt = Date.now();
    let costMicrousd = 0;
    let outcome: AttemptOutcome;
    let reason: string;
    let found: string | null = null;
    let documentType: string | null = null;
    let verdict: string | null = null;
    let overdraftPrice: boolean | null = null;
    let answer: ScheduleAnswer | null = null;

    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "schedule_search",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
          messages: [{ role: "user", content: scheduleSearchPrompt(row) }],
        },
      });
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      answer = paidResponseJson<ScheduleAnswer>(call.message);
      const proposed = typeof answer?.url === "string" ? answer.url.trim() : "";
      if (!proposed) {
        outcome = "no_candidates";
        reason = "Web search found no consumer fee schedule";
      } else if (!onBankDomain(proposed, row.website_url)) {
        outcome = "invalid_url";
        reason = `Answer is not on the bank's domain: ${proposed}`;
      } else if ((await knownUrls(db, institutionId, row.fee_schedule_url)).has(urlIdentity(proposed))) {
        outcome = "rejected";
        reason = `Answer is a document the bank already has: ${proposed}`;
      } else {
        try {
          const validation = await validateFeeCandidate({ url: proposed, score: ANSWER_SCORE, reasons: ["paid schedule search"] }, fetchImpl);
          verdict = validation.verdict;
          if (validation.ok) {
            outcome = "ok";
            found = proposed;
            documentType = validation.documentType ?? (looksLikePdfUrl(proposed) ? "pdf" : "html");
            overdraftPrice = validation.scoringText ? hasOverdraftPrice(validation.scoringText) : null;
            reason = `Paid schedule search: ${validation.reason}`;
          } else {
            outcome = validation.status != null && validation.status >= 400 ? classifyFetchFailure(validation.status) : "wrong_document";
            reason = `Answer failed the fee-page check (${validation.reason}): ${proposed}`;
          }
        } catch (error) {
          outcome = classifyFetchFailure(null, error);
          reason = `Answer could not be opened: ${error instanceof Error ? error.message : String(error)}`;
        }
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
    if (found) {
      result.found += 1;
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${found}, ${documentType}, 'consumer_supplement', ${SCHEDULE_SEARCH_STRATEGY.strategy},
           ${SCHEDULE_SEARCH_STRATEGY.version}, ${options.runId}, ${reason})
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: SCHEDULE_SEARCH_STRATEGY.strategy,
      version: SCHEDULE_SEARCH_STRATEGY.version,
      fingerprint: urlIdentity(row.fee_schedule_url),
      outcome,
      yieldCount: found ? 1 : 0,
      costMicrousd,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 3,
        model,
        url: found,
        held_link: row.fee_schedule_url,
        why_searched: whyNotIt(row),
        proposed_url: typeof answer?.url === "string" ? answer.url : null,
        evidence: typeof answer?.evidence === "string" ? answer.evidence.slice(0, 300) : null,
        verdict,
        document_type: documentType,
        overdraft_price_seen: overdraftPrice,
        reason,
      },
    });
    result.results.push({ institution_id: institutionId, outcome, url: found, cost_microusd: costMicrousd, reason, by: "schedule_search" });
  }
  return result;
}
