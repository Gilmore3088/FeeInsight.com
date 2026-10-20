import { feeSourceFetch } from "@/lib/agents/fee-source-fetch";
import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { lessonsForModel } from "@/lib/agents/learning/lesson-reader";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import {
  emptyPaidPassResult,
  PAID_PASS_ITEMS_PER_RUN,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseJson,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";

import { FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS, TRANSIENT_PAID_OUTCOMES } from "./cooldowns";
import { NOT_ONLINE_AFTER_MISSES, NOT_ONLINE_RETRY_DAYS, paidRung, type PaidRung } from "./escalation";
import { DISCOVERY_METHOD_VERSION, recordDiscoveryResult, type CandidateDiscoveryResult } from "./discovery";
import { runBlockedFetch } from "./blocked-fetch";
import { fetchWithTimeout, looksLikePdfUrl, validateFeeCandidate } from "./find-validate";
import { pageLinks, urlIdentity, type PageLink } from "./finders";
import { LARGE_BANK_ASSETS, onBankDomain, websiteHost } from "./link-coverage";
import { runScheduleSearch } from "./schedule-search";
import { runWebsiteFind } from "./website-find";
import { loadTopTenMissingIds, pickTopTenFirst, TOP_TEN_RETRY_DAYS } from "./top-ten-first";
import { loadSharedNameIds } from "./other-bank-host";
import { blockedAnswerHostConfirmed, loadOwnHosts, onBankHosts } from "./own-hosts";
import { domainRule, ownSiteDomains, webSearchToolFor } from "./web-search-tool";
import { loadGroupGaps, WORK_LIST_POOL, workListDetail, workListPoolRankSql, type GroupGaps, type WorkListPlacement } from "@/lib/agents/state-expert/work-list";

type Fetcher = typeof fetch;

/**
 * Pass 3 for Magellan: one paid web search per bank that every free finder missed.
 * Selects banks in the state whose last search with the current discovery method found
 * nothing and that are off the paid cooldown (`cooldowns.ts`), asks the model (with
 * Anthropic's server web_search tool) for the consumer fee schedule on the bank's own
 * domain, and stores the answer only after the same fee-page check the free finders
 * use. Every call is budget-checked and cost-logged by `paidModelCall`; a budget cap or
 * the automation stop ends the step cleanly.
 */

/**
 * Version 2 (2026-10-17, `top-ten-first.ts`): state top-10 slot holders with nothing live are
 * searched from any state's step, ahead of the work lists, and once a week inside the miss
 * cooldown when the ladder moves them to the disclosure rung.
 */
export const PAID_FIND_STRATEGY = { strategy: "discover.paid_web_search", version: 2 } as const;
/**
 * Before the web search: one model call, no tools, that picks the fee schedule from the
 * links already on the bank's homepage (a few cents of tokens, not a paid search). Its
 * picks pass the same fee-page check; the web search runs only when they all fail.
 * Set MAGELLAN_PAID_PICK=off to skip it.
 */
export const PAID_PICK_STRATEGY = { strategy: "discover.paid_pick", version: 1 } as const;
const PICK_MAX_LINKS = 160;
const PICK_MAX_PICKS = 3;
const PICK_MAX_OUTPUT_TOKENS = 300;
/** Link score given to a picked link: a pick is a label match, not a found document. */
const PICK_ANSWER_SCORE = 0.8;
const WEB_SEARCH_MAX_USES = 3;
const MAX_OUTPUT_TOKENS = 1024;
/** Link score given to the model's answer: strong enough to accept a scanned PDF. */
const PAID_ANSWER_SCORE = 0.85;
/** An answer the bank's site refused to show us (HTTP 403): kept, unchecked, for the paid fetch. */
const BLOCKED_ANSWER_CONFIDENCE = 0.75;
export { TRANSIENT_PAID_OUTCOMES };

interface PaidFindRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  cert_number?: string | null;
  /** Another institution has this name (`loadSharedNameIds`). */
  name_shared?: boolean;
  state_code: string | null;
  website_url: string;
  /** Thousands, as call reports. $10B+ banks, and banks with none on file, search the open web (web-search-tool.ts). */
  asset_size?: number | string | null;
  profile_consecutive_failures?: number | string | null;
  /** A paid web search for this bank is still on cooldown (only the pick is due). */
  web_searched?: boolean | null;
  /** Paid web-search misses on this website since the last paid find (escalation.ts). */
  paid_misses?: number | string | null;
  /** Holds a state top-10 slot with nothing live (`top-ten-first.ts`). */
  top_ten?: boolean | null;
  /** A top-10 slot holder's weekly try inside the miss cooldown, on the disclosure rung. */
  top_ten_retry?: boolean | null;
  /** The homepage pick ran inside its cooldown. */
  picked?: boolean | null;
  /** A report lead names it; a Pro account's own institution; its site platform (#1029 work lists). */
  requested?: boolean | null;
  paying?: boolean | null;
  platform?: string | null;
  work_list?: WorkListPlacement;
}

interface PaidFindAnswer {
  url?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}

export interface RunMagellanPaidFindOptions extends PaidStepOptions {
  /** Test seam for the model call. */
  create?: PaidMessageCreator;
  /** Test seam for the fee-page check. */
  fetchImpl?: Fetcher;
  /** Run the pick from homepage links before the web search (default on). */
  pick?: boolean;
}

/**
 * Due banks, ordered by the state experts' work lists (#1029): requesters and paying
 * customers first, then state top-10 slot holders with nothing live (`topTenIds`,
 * `top-ten-first.ts`), then one from each state's list in turn (`state-expert/work-list.ts`).
 * The query reads up to WORK_LIST_POOL due banks; `limit` (the step's cap) applies after.
 */
async function selectBanks(db: typeof sql, stateCode: string | null, limit: number, gaps: GroupGaps, topTenIds: number[]): Promise<PaidFindRow[]> {
  const currentMethod = JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION });
  const pool = await db<PaidFindRow[]>`
    SELECT inst.id, inst.institution_name, inst.city, inst.cert_number, inst.state_code, inst.website_url, inst.asset_size,
           profile.consecutive_failures AS profile_consecutive_failures,
           EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id) AS requested,
           EXISTS (
             SELECT 1 FROM institution_workspace_memberships pro
              WHERE pro.institution_id = inst.id AND pro.membership_status = 'active'
           ) AS paying,
           COALESCE(NULLIF(btrim(profile.platform), ''), NULLIF(btrim(inst.cms_platform), '')) AS platform,
           (cooled.web AND NOT retry.early) AS web_searched,
           cooled.pick AS picked,
           inst.id = ANY(${topTenIds}::bigint[]) AS top_ten,
           (cooled.web AND retry.early) AS top_ten_retry,
           ladder.misses AS paid_misses
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
      -- The rolling cooldowns (#1031: 90 days after a find, 30 after a miss, counted from the
      -- try) of the paid web search and the pick.
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM pipeline_attempts pa
             WHERE pa.institution_id = inst.id
               AND pa.stage = 'discover'
               AND pa.strategy = ${PAID_FIND_STRATEGY.strategy}
               AND pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok' THEN ${FOUND_COOLDOWN_DAYS}::int ELSE ${MISS_COOLDOWN_DAYS}::int END)
               AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES})
          ) AS web,
          EXISTS (
            SELECT 1 FROM pipeline_attempts pa
             WHERE pa.institution_id = inst.id
               AND pa.stage = 'discover'
               AND pa.strategy = ${PAID_PICK_STRATEGY.strategy}
               AND pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok' THEN ${FOUND_COOLDOWN_DAYS}::int ELSE ${MISS_COOLDOWN_DAYS}::int END)
               AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES})
          ) AS pick
      ) cooled ON true
      -- Escalation ladder (#1032; escalation.ts paidLadderSql): paid web-search misses on
      -- this website since the last paid find.
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS misses, max(pa.created_at) AS last_miss_at
          FROM pipeline_attempts pa
         WHERE pa.institution_id = inst.id
           AND pa.stage = 'discover'
           AND pa.strategy = ${PAID_FIND_STRATEGY.strategy}
           AND pa.outcome <> 'ok'
           AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES}::text[])
           AND COALESCE(pa.detail->>'website_url', inst.website_url) = inst.website_url
           AND pa.created_at > COALESCE((
             SELECT max(found.created_at) FROM pipeline_attempts found
              WHERE found.institution_id = inst.id
                AND found.stage = 'discover'
                AND found.strategy = ${PAID_FIND_STRATEGY.strategy}
                AND found.outcome = 'ok'
           ), '-infinity'::timestamptz)
      ) ladder ON true
      -- A state top-10 slot holder with nothing live (top-ten-first.ts) may skip the miss
      -- cooldown when the ladder's next rung is the disclosure (an odd miss count, after a
      -- schedule miss), at most once in TOP_TEN_RETRY_DAYS from its last real try. A find
      -- keeps its FOUND_COOLDOWN_DAYS; "not published online" below still holds it.
      LEFT JOIN LATERAL (
        SELECT (
          inst.id = ANY(${topTenIds}::bigint[])
          AND ladder.misses % 2 = 1
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_attempts pa
             WHERE pa.institution_id = inst.id
               AND pa.stage = 'discover'
               AND pa.strategy = ${PAID_FIND_STRATEGY.strategy}
               AND pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok' THEN ${FOUND_COOLDOWN_DAYS}::int ELSE ${TOP_TEN_RETRY_DAYS}::int END)
               AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES})
          )
        ) AS early
      ) retry ON true
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
       AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
       AND inst.rescue_status = 'dead'
       -- $10B+ banks, report requesters and state top-10 slot holders with nothing live are
       -- searched from any state's paid step: waiting for their own state's pass can take weeks.
       AND (
         ${stateCode}::text IS NULL
         OR upper(btrim(inst.state_code)) = ${stateCode}
         OR inst.asset_size >= ${LARGE_BANK_ASSETS}
         OR EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id)
         OR inst.id = ANY(${topTenIds}::bigint[])
       )
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND COALESCE(profile.locked_by_correction, false) = false
       -- "Not published online": NOT_ONLINE_AFTER_MISSES paid misses on this website, the
       -- last within NOT_ONLINE_RETRY_DAYS. No paid try (pick or search) until the retry.
       AND NOT (
         ladder.misses >= ${NOT_ONLINE_AFTER_MISSES}
         AND ladder.last_miss_at >= NOW() - make_interval(days => ${NOT_ONLINE_RETRY_DAYS}::int)
       )
       -- Every free finder ran with the current method and none found a link.
       AND EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.detail @> ${currentMethod}::jsonb
       )
       -- Due when the pick or the web search is off cooldown, or on a top-10 weekly try.
       AND (NOT cooled.pick OR NOT cooled.web OR retry.early)
     -- Requesters and paying customers first, then top-10 slot holders with nothing live, then
     -- each work-list cell's first rows in turn (#1269), so the cut never drops a whole
     -- small-bank group; the work lists reorder the rest.
     ORDER BY requested DESC, paying DESC, top_ten DESC,
              ${workListPoolRankSql(db, { state: "inst.state_code", assets: "inst.asset_size", id: "inst.id" })},
              inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${WORK_LIST_POOL}
  `;
  return pickTopTenFirst(Array.isArray(pool) ? pool : [], gaps, limit, (row) => Boolean(row.top_ten));
}

/** What a result entry and attempt record about the top-10 rule (`top-ten-first.ts`). */
function topTenDetail(row: Pick<PaidFindRow, "top_ten" | "top_ten_retry">): Record<string, unknown> {
  return row.top_ten ? { top_ten: true, top_ten_retry: Boolean(row.top_ten_retry) } : {};
}

export { onBankDomain };

/**
 * The disclosure rung's ask (#1032): where a bank that publishes no schedule lists its fees.
 * Only an open-web search is told about a parent company's domain (#1251).
 */
function disclosureRungAsk(openWeb: boolean): string[] {
  return [
    "This bank publishes no separate fee schedule that a search could find. Find the URL of the",
    "consumer document that lists its account fees instead: a Truth in Savings disclosure, a",
    "deposit account agreement, membership or account terms, or a checking or savings account",
    "disclosure that states service fees with dollar amounts (overdraft, NSF/returned item, stop",
    "payment, wire transfer, monthly maintenance). It may sit on a disclosures, forms or documents",
    openWeb ? "page, or on the parent company's domain." : "page.",
  ];
}

/**
 * `siteDomains` are the sites the search is limited to (`ownSiteDomains`), or null for the open
 * web. A site-limited search cannot reach a parent company's domain, so it is not offered one.
 */
export function paidFindPrompt(
  row: Pick<PaidFindRow, "institution_name" | "city" | "state_code" | "website_url">,
  rung: PaidRung = "schedule",
  siteDomains: string[] | null = null,
): string {
  const host = websiteHost(row.website_url) ?? row.website_url;
  const ask = rung === "disclosure" ? disclosureRungAsk(!siteDomains) : [
    "Find the URL of this bank's consumer fee schedule: the document (PDF or web page) that lists",
    "account service fees with dollar amounts, such as overdraft, NSF/returned item, stop payment,",
    "wire transfer, and monthly maintenance fees. It is often titled \"Schedule of Fees\",",
    "\"Fee Schedule\", \"Schedule of Charges\", \"Schedule of Service Charges\", \"Account Fee Schedule\",",
    siteDomains
      ? "\"Consumer Fees\", \"Deposit Account Agreement\", or \"Truth in Savings / Fee Disclosure\"."
      : "\"Consumer Fees\", \"Deposit Account Agreement\", or \"Truth in Savings / Fee Disclosure\". Large banks often",
    ...(siteDomains ? [] : ["publish it on their parent company's domain."]),
  ];
  return [
    ...ask,
    "",
    `Bank: ${row.institution_name}`,
    `Location: ${[row.city, row.state_code].filter(Boolean).join(", ") || "unknown"}`,
    `Website: ${row.website_url}`,
    "",
    "Rules:",
    domainRule(host, siteDomains),
    "- Do not return rate sheets, press releases, account agreements without fee amounts, or other sites.",
    "- If you cannot find it, answer with url null. Do not guess a URL you have not seen.",
    "",
    "Answer with JSON only:",
    "{\"url\": string | null, \"confidence\": number between 0 and 1, \"evidence\": \"one short sentence\"}",
  ].join("\n");
}

export function paidPickPrompt(row: Pick<PaidFindRow, "institution_name" | "state_code" | "website_url">, links: PageLink[]): string {
  return [
    "Below are the links on a bank's homepage. Pick the links most likely to open the bank's",
    "consumer fee schedule: the document or page that lists account service fees with dollar",
    "amounts (overdraft, NSF, stop payment, wire, monthly maintenance). Good labels include",
    "\"Schedule of Fees\", \"Fee Schedule\", \"Schedule of Charges\", \"Schedule of Service Charges\", \"Consumer Fees\",",
    "\"Deposit Account Agreement\", \"Truth in Savings\", \"Disclosures\", \"Forms & Documents\".",
    "Do not pick rates pages, loan or card pages, news, or careers.",
    "",
    `Bank: ${row.institution_name} (${row.state_code ?? "unknown state"}), website ${row.website_url}`,
    "",
    "Links (number. label | url):",
    ...links.map((link, index) => `${index + 1}. ${link.label || "(no label)"} | ${link.url}`),
    "",
    `Answer with JSON only: {"picks": [up to ${PICK_MAX_PICKS} link numbers, best first], "reason": "one short sentence"}`,
    "Answer {\"picks\": []} when no link fits.",
  ].join("\n");
}

interface PickAnswer {
  picks?: unknown;
  reason?: unknown;
}

/** Homepage links for the pick, or null when the homepage cannot be read. */
async function homepageLinks(row: PaidFindRow, fetchImpl: Fetcher): Promise<PageLink[] | null> {
  let site: URL;
  try {
    site = new URL(/^https?:\/\//i.test(row.website_url.trim()) ? row.website_url.trim() : `https://${row.website_url.trim()}`);
  } catch {
    return null;
  }
  try {
    const response = await fetchWithTimeout(fetchImpl, site.toString());
    if (!response.ok) return null;
    const html = await response.text();
    return pageLinks(html, new URL(response.url || site.toString())).slice(0, PICK_MAX_LINKS);
  } catch {
    return null;
  }
}

function budgetStop(error: unknown): string | null {
  if (error instanceof ProviderBudgetBlockedError) return error.message || error.reasonCode;
  if (error instanceof EmergencyStopActiveError) return error.message;
  return null;
}

function paidDiscovery(row: PaidFindRow, fields: Partial<CandidateDiscoveryResult> & Pick<CandidateDiscoveryResult, "outcome" | "reason">): CandidateDiscoveryResult {
  return {
    institutionId: Number(row.id),
    institutionName: row.institution_name,
    stateCode: normalizeStateCode(row.state_code),
    code: "found_paid_search",
    url: null,
    documentType: null,
    confidence: null,
    method: "magellan_paid_web_search",
    attemptedUrls: 1,
    foundBy: null,
    movedTo: null,
    platform: null,
    homepageHash: null,
    homepageBlocked: false,
    websiteRepair: null,
    finders: [],
    durationMs: 0,
    resumedFrom: null,
    resume: null,
    ...fields,
  };
}

export async function runMagellanPaidFind(options: RunMagellanPaidFindOptions): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  if (!(await learningSchemaReady(db))) return result;

  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit ?? PAID_PASS_ITEMS_PER_RUN)) || PAID_PASS_ITEMS_PER_RUN, PAID_PASS_ITEMS_PER_RUN));
  // The state experts' work lists (#1029) share one read of the coverage gaps.
  const gaps = await loadGroupGaps(db);
  // State top-10 slot holders with nothing live go first in both searches (top-ten-first.ts).
  const topTenIds = await loadTopTenMissingIds(db);
  const rows = await selectBanks(db, normalizeStateCode(options.stateCode), limit, gaps, topTenIds);
  result.selected = rows.length;
  if (dryRun) {
    result.results = rows.map((row) => ({ institution_id: Number(row.id), institution_name: row.institution_name, would_search: true, ...topTenDetail(row), ...workListDetail(row.work_list) }));
    await addWebsiteFind(result, options, db, gaps);
    await addScheduleSearch(result, options, db, gaps, topTenIds);
    return result;
  }

  // Known links the bank's site blocks go first: a few cheap calls on links already found.
  // Run last, they got what the run's call cap left (one bank of three on 7 Oct, 08:23).
  await addBlockedFetch(result, options, db);
  if (result.budgetStopped) return result;

  const fetchImpl = options.fetchImpl ?? feeSourceFetch;
  const model = PAID_PASS_MODELS.find();
  const usePick = options.pick ?? process.env.MAGELLAN_PAID_PICK?.trim().toLowerCase() !== "off";
  const ownHostsById = await loadOwnHosts(db, rows);
  const sharedNames = await loadSharedNameIds(db, rows, { runId: options.runId, stepId: options.stepId ?? null });
  for (const row of rows) {
    row.name_shared = sharedNames.has(Number(row.id));
    const institutionId = Number(row.id);
    const ownHosts = ownHostsById.get(institutionId) ?? [];
    const siteDomains = ownSiteDomains(row, ownHosts);
    const startedAt = Date.now();
    let costMicrousd = 0;
    let outcome: AttemptOutcome;
    let url: string | null = null;
    let reason: string;
    let documentType: string | null = null;
    let confidence: number | null = null;
    let answer: PaidFindAnswer | null = null;
    let verdict: string | null = null;
    const rung = paidRung(Number(row.paid_misses ?? 0));

    // A top-10 slot holder's early try skips a pick that already ran inside its cooldown: the
    // homepage links are the same, and the new ask is the disclosure rung's.
    if (usePick && !(row.top_ten_retry && row.picked)) {
      const picked = await runPick(row, { ...options, fetchImpl, model, db });
      result.costMicrousd += picked.costMicrousd;
      if (picked.budgetStopped) {
        result.budgetStopped = true;
        result.budgetReason = picked.budgetStopped;
        break;
      }
      if (picked.url) {
        result.processed += 1;
        result.succeeded += 1;
        await recordDiscoveryResult(db, paidDiscovery(row, {
          outcome: "discovered",
          url: picked.url,
          documentType: picked.documentType,
          confidence: picked.confidence,
          reason: picked.reason,
          method: "magellan_paid_pick",
          durationMs: Date.now() - startedAt,
        }));
        result.results.push({ institution_id: institutionId, outcome: "ok", url: picked.url, cost_microusd: picked.costMicrousd, reason: picked.reason, by: "pick", ...topTenDetail(row), ...workListDetail(row.work_list) });
        continue;
      }
      if (row.web_searched) {
        // The web search missed within its cooldown; the pick was the only new try.
        result.processed += 1;
        result.failed += 1;
        result.results.push({ institution_id: institutionId, outcome: picked.outcome, url: null, cost_microusd: picked.costMicrousd, reason: picked.reason, by: "pick", ...topTenDetail(row), ...workListDetail(row.work_list) });
        continue;
      }
    } else if (row.web_searched) {
      continue;
    }

    try {
      const roleLessons = lessonsForModel("magellan", "discover-paid");
      const call = await paidModelCall({
        agent: "magellan",
        operation: "paid_find",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null, lessons_applied: roleLessons.lessonIds },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tools: [webSearchToolFor(siteDomains, WEB_SEARCH_MAX_USES)],
          ...(roleLessons.system ? { system: roleLessons.system } : {}),
          messages: [{ role: "user", content: paidFindPrompt(row, rung, siteDomains) }],
        },
      });
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      answer = paidResponseJson<PaidFindAnswer>(call.message);
      const proposed = typeof answer?.url === "string" ? answer.url.trim() : "";
      if (!proposed) {
        outcome = "no_candidates";
        reason = rung === "disclosure" ? "Web search found no fee disclosure or account agreement" : "Web search found no fee schedule";
      } else if (!onBankHosts(proposed, row.website_url, ownHosts)) {
        outcome = "invalid_url";
        reason = `Answer is not on the bank's domain: ${proposed}`;
      } else {
        // The same check the free finders use: a rates page or press release is never stored.
        try {
          // With the bank's website and name, so an answer on another host must name the bank
          // (#1033's unconfirmed-host rule, find-validate.ts; #1251 review).
          const validation = await validateFeeCandidate(
            { url: proposed, score: PAID_ANSWER_SCORE, reasons: ["paid web search"], websiteUrl: row.website_url, institutionName: row.institution_name, nameShared: row.name_shared, city: row.city, certNumber: row.cert_number },
            fetchImpl,
          );
          verdict = validation.verdict;
          if (validation.ok) {
            outcome = "ok";
            url = proposed;
            documentType = validation.documentType;
            confidence = validation.confidence;
            reason = `Paid web search: ${validation.reason}`;
          } else if (validation.status === 403 && blockedAnswerHostConfirmed(proposed, row.website_url)) {
            // The bank's site refuses our fetcher (Huntington, KeyBank): keep the answer so
            // the paid fetch (blocked-fetch.ts) reads it; Rosetta then rules on the page.
            // Only on the website's own host or name: an unread page elsewhere can't show it
            // names the bank.
            outcome = "ok";
            url = proposed;
            documentType = looksLikePdfUrl(proposed) ? "pdf" : "html";
            confidence = BLOCKED_ANSWER_CONFIDENCE;
            reason = `Paid web search; the bank's site refused our check (HTTP 403), kept for the paid fetch: ${proposed}`;
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
        // Nothing was spent on this bank: it stays due for the next paid pass.
        result.budgetStopped = true;
        result.budgetReason = stopped;
        break;
      }
      outcome = classifyFetchFailure(null, error);
      reason = `Model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    result.processed += 1;
    if (url) result.succeeded += 1;
    else result.failed += 1;
    if (url) {
      await recordDiscoveryResult(db, paidDiscovery(row, {
        outcome: "discovered",
        url,
        documentType,
        confidence,
        reason,
        durationMs: Date.now() - startedAt,
      }));
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: PAID_FIND_STRATEGY.strategy,
      version: PAID_FIND_STRATEGY.version,
      fingerprint: urlIdentity(row.website_url),
      outcome,
      yieldCount: url ? 1 : 0,
      costMicrousd,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 3,
        method_version: DISCOVERY_METHOD_VERSION,
        // Escalation ladder (#1032): the rung asked, and the website the miss counts against.
        rung,
        website_url: row.website_url,
        search_domains: siteDomains,
        own_hosts: ownHosts,
        model,
        url,
        proposed_url: typeof answer?.url === "string" ? answer.url : null,
        model_confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
        evidence: typeof answer?.evidence === "string" ? answer.evidence.slice(0, 300) : null,
        verdict,
        document_type: documentType,
        reason,
        ...topTenDetail(row),
        ...workListDetail(row.work_list),
      },
    });
    result.results.push({ institution_id: institutionId, outcome, url, cost_microusd: costMicrousd, reason, rung, ...topTenDetail(row), ...workListDetail(row.work_list) });
  }
  if (!result.budgetStopped) await addWebsiteFind(result, options, db, gaps);
  if (!result.budgetStopped) await addScheduleSearch(result, options, db, gaps, topTenIds);
  return result;
}

/**
 * Fee links and companion pages the bank's site blocks (refused, timing out, or a PDF
 * answered with a web page) get one paid server-side fetch in the same step
 * (blocked-fetch.ts); what it returns is stored and read like any fetched document.
 */
async function addBlockedFetch(result: PaidPassResult, options: RunMagellanPaidFindOptions, db: typeof sql): Promise<void> {
  const fetched = await runBlockedFetch({
    runId: options.runId,
    stepId: options.stepId ?? null,
    dryRun: Boolean(options.dryRun),
    db,
    create: options.create,
  });
  result.selected += fetched.selected;
  result.processed += fetched.processed;
  result.succeeded += fetched.stored;
  result.failed += fetched.failed;
  result.costMicrousd += fetched.costMicrousd;
  if (fetched.budgetStopped) {
    result.budgetStopped = true;
    result.budgetReason = fetched.budgetReason;
  }
  result.results.push(...fetched.results);
}

/**
 * The paid schedule search runs in the same step (schedule-search.ts, #1030): institutions
 * with a link but no live fee first, then a few banks whose page is not the consumer schedule;
 * each answer is kept as a companion.
 */
async function addScheduleSearch(result: PaidPassResult, options: RunMagellanPaidFindOptions, db: typeof sql, gaps: GroupGaps, topTenIds: number[]): Promise<void> {
  const searched = await runScheduleSearch({
    gaps,
    topTenIds,
    runId: options.runId,
    stepId: options.stepId ?? null,
    dryRun: Boolean(options.dryRun),
    db,
    create: options.create,
    fetchImpl: options.fetchImpl,
  });
  result.selected += searched.selected;
  result.processed += searched.processed;
  result.succeeded += searched.found;
  result.failed += searched.processed - searched.found;
  result.costMicrousd += searched.costMicrousd;
  if (searched.budgetStopped) {
    result.budgetStopped = true;
    result.budgetReason = searched.budgetReason;
  }
  result.results.push(...searched.results);
}

/**
 * Institutions with no website at all get a website search in the same paid step
 * (website-find.ts), so they reach the free finders on their next search.
 */
async function addWebsiteFind(result: PaidPassResult, options: RunMagellanPaidFindOptions, db: typeof sql, gaps: GroupGaps): Promise<void> {
  const found = await runWebsiteFind({
    gaps,
    runId: options.runId,
    stepId: options.stepId ?? null,
    stateCode: options.stateCode ?? null,
    dryRun: Boolean(options.dryRun),
    db,
    create: options.create,
    fetchImpl: options.fetchImpl,
  });
  result.selected += found.selected;
  result.processed += found.processed;
  result.succeeded += found.saved;
  result.failed += found.needsHuman;
  result.costMicrousd += found.costMicrousd;
  if (found.budgetStopped) {
    result.budgetStopped = true;
    result.budgetReason = found.budgetReason;
  }
  result.results.push(...found.results);
}

interface PickResult {
  url: string | null;
  documentType: string | null;
  confidence: number | null;
  reason: string;
  outcome: AttemptOutcome;
  costMicrousd: number;
  /** Set when a budget cap or the automation stop ended the step (nothing was spent). */
  budgetStopped: string | null;
}

/** One model call that picks from the homepage's links, then the fee-page check on each pick. */
async function runPick(
  row: PaidFindRow,
  options: RunMagellanPaidFindOptions & { fetchImpl: Fetcher; model: string; db: typeof sql },
): Promise<PickResult> {
  const institutionId = Number(row.id);
  const startedAt = Date.now();
  const links = await homepageLinks(row, options.fetchImpl);
  let costMicrousd = 0;
  let outcome: AttemptOutcome = "no_candidates";
  let reason = "Homepage could not be read, so there were no links to pick from";
  let url: string | null = null;
  let documentType: string | null = null;
  let confidence: number | null = null;
  let pickedUrls: string[] = [];
  const verdicts: Array<{ url: string; verdict: string }> = [];
  let modelReason: string | null = null;

  if (links && links.length > 0) {
    try {
      const roleLessons = lessonsForModel("magellan", "discover-paid");
      const call = await paidModelCall({
        agent: "magellan",
        operation: "paid_pick",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null, links: links.length, lessons_applied: roleLessons.lessonIds },
        params: {
          model: options.model,
          max_tokens: PICK_MAX_OUTPUT_TOKENS,
          ...(roleLessons.system ? { system: roleLessons.system } : {}),
          messages: [{ role: "user", content: paidPickPrompt(row, links) }],
        },
      });
      costMicrousd = call.costMicrousd;
      const answer = paidResponseJson<PickAnswer>(call.message);
      modelReason = typeof answer?.reason === "string" ? answer.reason.slice(0, 300) : null;
      const picks = Array.isArray(answer?.picks) ? answer.picks : [];
      pickedUrls = picks
        .map((pick) => (typeof pick === "number" ? links[pick - 1]?.url : null))
        .filter((pick): pick is string => Boolean(pick))
        .slice(0, PICK_MAX_PICKS);
      outcome = "no_candidates";
      reason = pickedUrls.length === 0 ? "No homepage link looked like the fee schedule" : "Every picked link failed the fee-page check";
      for (const candidate of pickedUrls) {
        try {
          const validation = await validateFeeCandidate(
            { url: candidate, score: PICK_ANSWER_SCORE, reasons: ["paid pick"], websiteUrl: row.website_url, institutionName: row.institution_name, nameShared: row.name_shared, city: row.city, certNumber: row.cert_number },
            options.fetchImpl,
          );
          verdicts.push({ url: candidate, verdict: validation.verdict });
          if (validation.ok) {
            outcome = "ok";
            url = candidate;
            documentType = validation.documentType;
            confidence = validation.confidence;
            reason = `Picked from homepage links: ${validation.reason}`;
            break;
          }
          outcome = "wrong_document";
        } catch {
          verdicts.push({ url: candidate, verdict: "fetch_failed" });
        }
      }
    } catch (error) {
      const stopped = budgetStop(error);
      if (stopped) {
        return { url: null, documentType: null, confidence: null, reason: stopped, outcome: "budget_blocked", costMicrousd: 0, budgetStopped: stopped };
      }
      outcome = classifyFetchFailure(null, error);
      reason = `Model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  await recordAttempt(options.db, {
    institutionId,
    stage: "discover",
    strategy: PAID_PICK_STRATEGY.strategy,
    version: PAID_PICK_STRATEGY.version,
    fingerprint: urlIdentity(row.website_url),
    outcome,
    yieldCount: url ? 1 : 0,
    costMicrousd,
    durationMs: Date.now() - startedAt,
    runId: options.runId,
    stepId: options.stepId ?? null,
    detail: {
      pass: 3,
      method_version: DISCOVERY_METHOD_VERSION,
      model: options.model,
      url,
      links: links?.length ?? 0,
      picks: pickedUrls,
      verdicts,
      model_reason: modelReason,
      document_type: documentType,
      reason,
      ...topTenDetail(row),
      ...workListDetail(row.work_list),
    },
  });
  return { url, documentType, confidence, reason, outcome, costMicrousd, budgetStopped: null };
}
